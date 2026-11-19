const fs = require("fs");
const path = require("path");
const vm = require("vm");

jest.mock("../../../../models/account", () => ({ findOne: jest.fn(), find: jest.fn() }));
const Account = require("../../../../models/account");
const ModAction = require("../../../../models/modAction");
const Profile = require("../../../../models/profile");
const { obfIP } = require("../../../../routes/socket/ip-obf");
const { handleAccountIPLookup } = require("../../../../routes/socket/user-events/mod-account-ips");

const query = (result) => ({
  select: jest.fn().mockReturnThis(),
  maxTimeMS: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(result),
});
const socketFor = (user = "Staff") => ({
  handshake: { session: { passport: { user, staffRole: "admin" } } },
  emit: jest.fn(),
});
const target = { username: "Legacy", signupIP: "192.0.2.10", lastConnectedIP: "198.51.100.20" };
let role, targetRecord, queries;
beforeEach(() => {
  jest.clearAllMocks();
  role = "moderator";
  targetRecord = target;
  queries = [];
  Account.find.mockResolvedValue([]);
  Account.findOne.mockImplementation(({ username }) => {
    const q = query(username === "Staff" ? { staffRole: role } : targetRecord);
    queries.push(q);
    return q;
  });
  jest.spyOn(ModAction.prototype, "save").mockResolvedValue();
  jest.spyOn(Profile, "findById").mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

it.each([
  "moderator",
  "editor",
  "admin",
])("returns only both obfuscated fields to a current %s without a profile", async (staffRole) => {
  role = staffRole;
  const callback = jest.fn();
  await handleAccountIPLookup(socketFor(), { username: " Legacy " }, callback);
  expect(callback).toHaveBeenCalledWith({
    success: true,
    exists: true,
    username: "Legacy",
    signupIP: `-${obfIP(target.signupIP)}`,
    lastConnectedIP: `-${obfIP(target.lastConnectedIP)}`,
  });
  expect(Account.findOne.mock.calls).toEqual([
    [{ username: "Staff" }],
    [{ username: "Legacy" }],
    [{ username: "Staff" }],
  ]);
  expect(queries[1].select).toHaveBeenCalledWith("username signupIP lastConnectedIP");
  for (const q of queries) expect(q.maxTimeMS).toHaveBeenCalledWith(2000);
  expect(JSON.stringify(callback.mock.calls)).not.toContain(target.signupIP);
  expect(JSON.stringify(callback.mock.calls)).not.toContain(target.lastConnectedIP);
  expect(Profile.findById).not.toHaveBeenCalled();
  expect(ModAction.prototype.save).not.toHaveBeenCalled();
});

it.each([
  "",
  "trialmod",
  "altmod",
  "veteran",
  "eventmod",
  "tourneymod",
  "owner",
  undefined,
])("refuses '%s' even when the session claims admin/event privileges", async (staffRole) => {
  role = staffRole;
  const socket = socketFor();
  socket.handshake.session.passport.isTournamentMod = true;
  const callback = jest.fn();
  await handleAccountIPLookup(socket, { username: "Legacy" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: false, error: expect.any(String) });
  expect(Account.findOne).toHaveBeenCalledTimes(1);
});

it("does not query accounts for an anonymous caller or a caller without an acknowledgement", async () => {
  const socket = { handshake: { session: {} } };
  await handleAccountIPLookup(socket, { username: "Legacy" }, jest.fn());
  await handleAccountIPLookup(socketFor(), { username: "Legacy" });
  expect(Account.findOne).not.toHaveBeenCalled();
});

it.each([
  null,
  {},
  [],
  { username: { $ne: null } },
  { username: "" },
  { username: "x".repeat(101) },
  { username: "Legacy", staffRole: "admin" },
])("rejects malformed request %j before lookup", async (request) => {
  const callback = jest.fn();
  await handleAccountIPLookup(socketFor(), request, callback);
  expect(Account.findOne).not.toHaveBeenCalled();
  expect(callback).toHaveBeenCalledWith({ success: false, error: expect.any(String) });
});

it.each([
  [{ username: "Legacy" }, null, null],
  [{ username: "Legacy", signupIP: "192.0.2.10" }, `-${obfIP("192.0.2.10")}`, null],
  [{ username: "Legacy", lastConnectedIP: "::ffff:198.51.100.20" }, null, `-${obfIP("198.51.100.20")}`],
  [
    { username: "Legacy", signupIP: "2001:DB8::1", lastConnectedIP: "2001:db8:0:0:0:0:0:2" },
    `-${obfIP("2001:db8::1")}`,
    `-${obfIP("2001:db8:0:0:0:0:0:2")}`,
  ],
  [{ username: "Legacy", signupIP: "invalid-raw-secret", lastConnectedIP: "192.0.2.1/24" }, null, null],
  [{ username: "Legacy", signupIP: { raw: "secret" }, lastConnectedIP: "-already-obfuscated" }, null, null],
])("represents missing or invalid historical fields independently", async (record, signupIP, lastConnectedIP) => {
  targetRecord = record;
  const callback = jest.fn();
  await handleAccountIPLookup(socketFor(), { username: "Legacy" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: true, exists: true, username: "Legacy", signupIP, lastConnectedIP });
});

it("distinguishes no account from an account whose IP fields are missing", async () => {
  targetRecord = null;
  const callback = jest.fn();
  await handleAccountIPLookup(socketFor(), { username: "Legacy" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: true, exists: false, username: "Legacy" });
});

it("withholds the result after demotion while the target query is in progress", async () => {
  Account.findOne
    .mockImplementationOnce(() => query({ staffRole: "admin" }))
    .mockImplementationOnce(() => query(target))
    .mockImplementationOnce(() => query({ staffRole: "trialmod" }));
  const callback = jest.fn();
  await handleAccountIPLookup(socketFor(), { username: "Legacy" }, callback);
  expect(callback).toHaveBeenCalledWith({ success: false, error: expect.any(String) });
  expect(JSON.stringify(callback.mock.calls)).not.toContain("signupIP");
});

it.each([
  "disconnected",
  "_replacedBySocketId",
])("does not deliver an answer after the socket becomes %s", async (field) => {
  const socket = socketFor();
  Account.findOne
    .mockImplementationOnce(() => query({ staffRole: "admin" }))
    .mockImplementationOnce(() => {
      socket[field] = true;
      return query(target);
    });
  const callback = jest.fn();
  await handleAccountIPLookup(socket, { username: "Legacy" }, callback);
  expect(callback).not.toHaveBeenCalled();
});

it("contains database errors without logging or returning their stored IP data", async () => {
  const error = new Error(`Driver failed reading ${target.signupIP}`);
  Account.findOne.mockReturnValue({ select: () => ({ maxTimeMS: () => ({ lean: () => Promise.reject(error) }) }) });
  const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  const callback = jest.fn();
  await expect(handleAccountIPLookup(socketFor(), { username: "Legacy" }, callback)).resolves.toBeUndefined();
  expect(JSON.stringify(callback.mock.calls)).not.toContain(target.signupIP);
  expect(consoleSpy).not.toHaveBeenCalled();
});

it("bounds a socket to one pending lookup and releases that guard afterwards", async () => {
  let resolve;
  Account.findOne.mockReturnValueOnce({
    select: () => ({
      maxTimeMS: () => ({
        lean: () =>
          new Promise((r) => {
            resolve = r;
          }),
      }),
    }),
  });
  const socket = socketFor();
  const first = handleAccountIPLookup(socket, { username: "Legacy" }, jest.fn());
  const duplicate = jest.fn();
  await handleAccountIPLookup(socket, { username: "Legacy" }, duplicate);
  expect(duplicate).toHaveBeenCalledWith({ success: false, error: expect.stringContaining("wait") });
  resolve({ staffRole: "moderator" });
  await first;
  const next = jest.fn();
  await handleAccountIPLookup(socket, { username: "Legacy" }, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

it("wires the actual socket route to the protected lookup instead of relying on its connection-time staff flag", async () => {
  const handlers = {};
  let connect;
  const noop = jest.fn();
  const otherExports = new Proxy({}, { get: () => noop });
  const modules = {
    "./user-events": { checkUserStatus: (socket, callback) => callback(null) },
    "./user-events/mod-account-ips": { handleAccountIPLookup },
    "./models": { games: {}, modDMs: {}, emoteList: [] },
    "../../models/account": Account,
    mongoose: { connection: { readyState: 0, once: noop } },
  };
  const exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../../../routes/socket/routes.js"), "utf8"), {
    require: (name) => modules[name] || otherExports,
    module: exported,
    setInterval: noop,
    io: {
      on: (event, callback) => {
        if (event === "connection") connect = callback;
      },
    },
  });
  exported.exports.socketRoutes();
  const socket = {
    ...socketFor(),
    on: (event, handler) => {
      handlers[event] = handler;
    },
    use: noop,
  };
  connect(socket);
  expect(typeof handlers.lookupAccountIPs).toBe("function");
  const callback = jest.fn();
  await handlers.lookupAccountIPs({ username: "Legacy" }, callback);
  // The route intentionally does not return the promise; drain its bounded reads.
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(callback).toHaveBeenCalledWith(
    expect.objectContaining({ success: true, signupIP: expect.stringMatching(/^-/) })
  );
});
