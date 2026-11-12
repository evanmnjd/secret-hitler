jest.mock("../../../../models/account", () => ({ findOne: jest.fn() }));
const Account = require("../../../../models/account");
const { handleModAccountExistence } = require("../../../../routes/socket/user-events/mod-account-existence");

const query = (value) => ({
  select: jest.fn().mockReturnThis(),
  maxTimeMS: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
});
const socketFor = (user = "Mod") => ({ handshake: { session: { passport: { user } } } });
beforeEach(() => jest.resetAllMocks());

it.each([
  "moderator",
  "editor",
  "admin",
])("checks Account records for a current %s without needing a profile", async (staffRole) => {
  const actor = query({ staffRole });
  const target = query({ _id: "empty-profile-account" });
  Account.findOne.mockReturnValueOnce(actor).mockReturnValueOnce(target);
  const callback = jest.fn();
  await handleModAccountExistence(socketFor(), { username: "  Alice  " }, callback);
  expect(Account.findOne.mock.calls).toEqual([[{ username: "Mod" }], [{ username: "Alice" }]]);
  expect(actor.select).toHaveBeenCalledWith("staffRole");
  expect(target.select).toHaveBeenCalledWith("_id");
  expect(actor.maxTimeMS).toHaveBeenCalledWith(2000);
  expect(target.maxTimeMS).toHaveBeenCalledWith(2000);
  expect(callback).toHaveBeenCalledWith({ success: true, username: "Alice", exists: true });
});

it.each([
  "trialmod",
  "altmod",
  "tournamentmod",
  "eventmod",
  "veteran",
  "contributor",
  "",
  "future-role",
])("rejects a current %s, even with a stale admin session claim", async (staffRole) => {
  Account.findOne.mockReturnValue(query({ staffRole, isTournamentMod: true }));
  const socket = socketFor();
  socket.handshake.session.passport.staffRole = "admin";
  const callback = jest.fn();
  await handleModAccountExistence(socket, { username: "Alice" }, callback);
  expect(Account.findOne).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith({ success: false, error: expect.any(String) });
});

it("reports absence independently from a lookup failure", async () => {
  Account.findOne.mockReturnValueOnce(query({ staffRole: "moderator" })).mockReturnValueOnce(query(null));
  const callback = jest.fn();
  await handleModAccountExistence(socketFor(), { username: "Missing" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: true, username: "Missing", exists: false });
  Account.findOne.mockImplementationOnce(() => {
    throw new Error("database unavailable");
  });
  const failed = jest.fn();
  await expect(handleModAccountExistence(socketFor(), { username: "Missing" }, failed)).resolves.toBeUndefined();
  expect(failed).toHaveBeenCalledWith({ success: false, error: expect.any(String) });
});

it.each([
  null,
  {},
  [],
  { username: { $ne: null } },
  { username: "" },
  { username: " " },
  { username: "a".repeat(101) },
  { username: "Alice", extra: true },
])("rejects invalid input %j before querying", async (request) => {
  const callback = jest.fn();
  await handleModAccountExistence(socketFor(), request, callback);
  expect(Account.findOne).not.toHaveBeenCalled();
  expect(callback).toHaveBeenCalledWith({ success: false, error: expect.any(String) });
});

it("rejects anonymous, disconnected and replaced sessions without querying", async () => {
  for (const socket of [{}, { ...socketFor(), disconnected: true }, { ...socketFor(), _replacedBySocketId: "new" }]) {
    const callback = jest.fn();
    await handleModAccountExistence(socket, { username: "Alice" }, callback);
    expect(callback).toHaveBeenCalledWith({ success: false, error: expect.any(String) });
  }
  expect(Account.findOne).not.toHaveBeenCalled();
});

it("does not query without an acknowledgment callback", async () => {
  await handleModAccountExistence(socketFor(), { username: "Alice" });
  expect(Account.findOne).not.toHaveBeenCalled();
});

it("never returns a privileged result to a changed socket identity", async () => {
  let finish;
  const target = query(null);
  target.lean.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  Account.findOne.mockReturnValueOnce(query({ staffRole: "moderator" })).mockReturnValueOnce(target);
  const socket = socketFor();
  const callback = jest.fn();
  const pending = handleModAccountExistence(socket, { username: "Alice" }, callback);
  await new Promise((resolve) => setImmediate(resolve));
  socket.handshake.session.passport.user = "SomeoneElse";
  finish({ _id: "target" });
  await pending;
  expect(callback).not.toHaveBeenCalled();
});

it("allows only one pending request and does not send a result after connection replacement", async () => {
  let finish;
  const actor = query(null);
  actor.lean.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  Account.findOne.mockReturnValueOnce(actor).mockReturnValueOnce(query({ _id: "target" }));
  const socket = socketFor();
  const callback = jest.fn();
  const pending = handleModAccountExistence(socket, { username: "Alice" }, callback);
  const other = jest.fn();
  await handleModAccountExistence(socket, { username: "Bob" }, other);
  expect(other).toHaveBeenCalledWith({ success: false, error: expect.any(String) });
  expect(Account.findOne).toHaveBeenCalledTimes(1);
  socket._replacedBySocketId = "new";
  finish({ staffRole: "admin" });
  await pending;
  expect(callback).not.toHaveBeenCalled();
});
