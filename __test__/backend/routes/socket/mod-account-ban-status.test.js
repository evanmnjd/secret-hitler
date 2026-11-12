jest.mock("../../../../models/account", () => ({ findOne: jest.fn() }));
jest.mock("../../../../models/modAction", () => ({ find: jest.fn(), create: jest.fn(), insertMany: jest.fn() }));
jest.mock("../../../../models/profile", () => ({ findOne: jest.fn(), create: jest.fn() }));

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Account = require("../../../../models/account");
const ModAction = require("../../../../models/modAction");
const Profile = require("../../../../models/profile");
const { handleAccountBanStatus } = require("../../../../routes/socket/user-events/mod-account-ban-status");

const query = (result) => ({
  select: jest.fn().mockReturnThis(),
  maxTimeMS: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
});
const socket = (username = "Staff") => ({ handshake: { session: { passport: { user: username } } } });
let staffQuery, targetQuery;
beforeEach(() => {
  jest.clearAllMocks();
  Account.findOne.mockReset();
  staffQuery = query({ staffRole: "moderator" });
  targetQuery = query({ isBanned: true });
  Account.findOne.mockReturnValueOnce(staffQuery).mockReturnValue(targetQuery);
});
afterEach(() => {
  expect(ModAction.find).not.toHaveBeenCalled();
  expect(ModAction.create).not.toHaveBeenCalled();
  expect(ModAction.insertMany).not.toHaveBeenCalled();
  expect(Profile.findOne).not.toHaveBeenCalled();
  expect(Profile.create).not.toHaveBeenCalled();
});

it.each([
  "moderator",
  "editor",
  "admin",
])("permits a current %s and returns only the requested status", async (staffRole) => {
  staffQuery.lean.mockResolvedValue({ staffRole });
  const callback = jest.fn();
  await handleAccountBanStatus(socket(), { username: " Alice " }, callback);
  expect(Account.findOne.mock.calls).toEqual([[{ username: "Staff" }], [{ username: "Alice" }]]);
  expect(staffQuery.select).toHaveBeenCalledWith("staffRole");
  expect(targetQuery.select).toHaveBeenCalledWith("isBanned");
  expect(staffQuery.maxTimeMS).toHaveBeenCalledWith(2000);
  expect(targetQuery.maxTimeMS).toHaveBeenCalledWith(2000);
  expect(callback).toHaveBeenCalledWith({ success: true, username: "Alice", exists: true, isBanned: true });
});

it.each([
  "trialmod",
  "eventmod",
  "tourneymod",
  "altmod",
  "veteran",
  "",
  undefined,
])("denies a current role %s despite stale admin or event permissions", async (staffRole) => {
  staffQuery.lean.mockResolvedValue({ staffRole });
  const connection = socket();
  connection.handshake.session.passport.staffRole = "admin";
  connection.isTournamentMod = true;
  const callback = jest.fn();
  await handleAccountBanStatus(connection, { username: "Alice" }, callback);
  expect(Account.findOne).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith({ success: false, error: expect.stringContaining("access") });
});

it("denies an account that has been deleted since the socket connected", async () => {
  staffQuery.lean.mockResolvedValue(null);
  const callback = jest.fn();
  await handleAccountBanStatus(socket(), { username: "Alice" }, callback);
  expect(Account.findOne).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0][0].success).toBe(false);
});

it.each([false, undefined])("treats an existing legacy account with isBanned=%s as not banned", async (isBanned) => {
  targetQuery.lean.mockResolvedValue({ isBanned });
  const callback = jest.fn();
  await handleAccountBanStatus(socket(), { username: "NoPublicGames" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: true, username: "NoPublicGames", exists: true, isBanned: false });
});

it("distinguishes missing accounts from existing unbanned accounts", async () => {
  targetQuery.lean.mockResolvedValue(null);
  const callback = jest.fn();
  await handleAccountBanStatus(socket(), { username: "Missing" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: true, username: "Missing", exists: false });
});

it.each([
  null,
  {},
  [],
  { username: "" },
  { username: "  " },
  { username: {} },
  { username: "a".repeat(101) },
  { username: "Alice", extra: true },
])("rejects malformed requests %j without querying accounts", async (request) => {
  const callback = jest.fn();
  await handleAccountBanStatus(socket(), request, callback);
  expect(Account.findOne).not.toHaveBeenCalled();
  expect(callback.mock.calls[0][0].success).toBe(false);
});

it.each([
  {},
  { handshake: { session: {} } },
  socket(null),
  { ...socket(), disconnected: true },
  { ...socket(), _replacedBySocketId: "other" },
])("rejects an unavailable or unauthenticated connection %j", async (connection) => {
  const callback = jest.fn();
  await handleAccountBanStatus(connection, { username: "Alice" }, callback);
  expect(Account.findOne).not.toHaveBeenCalled();
  expect(callback.mock.calls[0][0].success).toBe(false);
});

it("performs no work without an acknowledgement callback", async () => {
  await handleAccountBanStatus(socket(), { username: "Alice" });
  expect(Account.findOne).not.toHaveBeenCalled();
});

it.each([
  "staff",
  "target",
])("reports a %s query failure without pretending that the account is missing", async (failed) => {
  (failed === "staff" ? staffQuery : targetQuery).lean.mockRejectedValue(new Error("database offline"));
  const callback = jest.fn();
  await handleAccountBanStatus(socket(), { username: "Alice" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: false, error: expect.stringContaining("Unable") });
  expect(JSON.stringify(callback.mock.calls)).not.toContain("database offline");
});

it("does not release private results after the socket is replaced", async () => {
  const connection = socket();
  targetQuery.lean.mockImplementation(async () => {
    connection._replacedBySocketId = "new";
    return { isBanned: true };
  });
  const callback = jest.fn();
  await handleAccountBanStatus(connection, { username: "Alice" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: false, error: expect.stringContaining("connection changed") });
});

it("bounds repeated requests on the same connection", async () => {
  const connection = socket();
  const callback = jest.fn();
  await handleAccountBanStatus(connection, { username: "Alice" }, callback);
  await handleAccountBanStatus(connection, { username: "Bob" }, callback);
  expect(Account.findOne).toHaveBeenCalledTimes(2);
  expect(callback.mock.calls[1][0]).toEqual({ success: false, error: expect.stringContaining("wait") });
});

it("wires the actual socket listener to the checked handler without a cached-role shortcut", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../../../../routes/socket/routes.js"), "utf8");
  const listener = source.match(/socket\.on\("getAccountBanStatus",[\s\S]*?\n {6}\}\);/)[0];
  let receive;
  const connection = {
    ...socket(),
    on: (event, handler) => {
      expect(event).toBe("getAccountBanStatus");
      receive = handler;
    },
  };
  vm.runInNewContext(listener, { socket: connection, handleAccountBanStatus });
  const callback = jest.fn();
  await receive({ username: "Alice" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: true, username: "Alice", exists: true, isBanned: true });
});
