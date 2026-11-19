jest.mock("../../../../routes/socket/user-events", () => ({
  checkUserStatus: jest.fn((socket, ready) => ready(socket.initialAccount)),
}));
jest.mock("../../../../routes/socket/user-requests", () => ({
  sendGeneralChats: jest.fn(),
  sendGameList: jest.fn(),
  sendUserList: jest.fn(),
  sendUserGameSettings: jest.fn(),
}));
jest.mock("../../../../routes/socket/bandwidth-diagnostics", () => ({ instrumentSocket: jest.fn() }));
jest.mock("https", () => ({ request: jest.fn() }));

const mongoose = require("mongoose");
const https = require("https");
const Account = require("../../../../models/account");
const { socketRoutes } = require("../../../../routes/socket/routes");
const { handleUpdatedTheme } = require("../../../../routes/socket/user-events/settings");
const { TOU_CHANGES } = require("../../../../src/frontend-scripts/node-constants");

const originalIO = global.io;
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const account = (overrides = {}) => ({
  username: "Player",
  touLastAgreed: TOU_CHANGES[0].changeVer,
  warnings: [],
  save: jest.fn().mockResolvedValue(),
  markModified: jest.fn(),
  ...overrides,
});
let connect, request;
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Account, "find").mockResolvedValue([]);
  jest.spyOn(Account, "findOne").mockResolvedValue(null);
  jest.spyOn(mongoose.connection, "once").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  request = { on: jest.fn(), end: jest.fn() };
  https.request.mockReturnValue(request);
  global.io = { on: jest.fn() };
  socketRoutes();
  connect = global.io.on.mock.calls.find(([event]) => event === "connection")[1];
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  https.request.mockReset();
  global.io = originalIO;
});
const session = async (initialAccount) => {
  const handlers = {};
  const socket = {
    id: "account-request-test",
    initialAccount,
    handshake: { headers: {}, session: { passport: initialAccount ? { user: initialAccount.username } : undefined } },
    emit: jest.fn(),
    use: jest.fn(),
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
  };
  connect(socket);
  await settle();
  socket.emit.mockClear();
  return { socket, handlers };
};

it("ignores restriction refreshes without an authenticated account", async () => {
  const { handlers } = await session();
  await expect(handlers.receiveRestrictions()).resolves.toBeUndefined();
  expect(Account.findOne).not.toHaveBeenCalled();
});

it.each([
  "receiveRestrictions",
  "confirmTOU",
  "acknowledgeWarning",
])("handles an account deleted before %s", async (event) => {
  const { handlers } = await session(account({ warnings: [{ acknowledged: false }] }));
  await expect(handlers[event]()).resolves.toBeUndefined();
  expect(Account.findOne).toHaveBeenCalledWith({ username: "Player" });
});

it.each([
  "receiveRestrictions",
  "confirmTOU",
  "acknowledgeWarning",
])("contains a database failure during %s", async (event) => {
  const { socket, handlers } = await session(account({ warnings: [{ acknowledged: false }] }));
  Account.findOne.mockRejectedValueOnce(new Error("temporary connection failure"));
  await expect(handlers[event]()).resolves.toBeUndefined();
  expect(socket.emit).toHaveBeenCalledWith("sendAlert", expect.stringContaining("Please try again"));
});

it("allows one restriction refresh at a time and recovers after lookup failure", async () => {
  const { handlers } = await session(account());
  let reject;
  Account.findOne.mockReturnValueOnce(
    new Promise((resolve, fail) => {
      reject = fail;
    })
  );
  const first = handlers.receiveRestrictions();
  await handlers.receiveRestrictions();
  expect(Account.findOne).toHaveBeenCalledTimes(1);
  reject(new Error("temporary connection failure"));
  await first;
  Account.findOne.mockResolvedValueOnce(account());
  await handlers.receiveRestrictions();
  expect(Account.findOne).toHaveBeenCalledTimes(2);
});

it("accepts terms during a pending refresh and discards that older refresh's result", async () => {
  const { socket, handlers } = await session(account({ touLastAgreed: undefined }));
  let resolveRefresh;
  const current = account({ touLastAgreed: undefined });
  Account.findOne
    .mockReturnValueOnce(
      new Promise((done) => {
        resolveRefresh = done;
      })
    )
    .mockResolvedValueOnce(current);
  const refresh = handlers.receiveRestrictions();
  await handlers.confirmTOU();
  expect(current.save).toHaveBeenCalledTimes(1);
  expect(socket.emit).toHaveBeenCalledWith("removeAllPopups");
  socket.emit.mockClear();
  resolveRefresh(account({ touLastAgreed: undefined }));
  await refresh;
  expect(socket.emit).not.toHaveBeenCalledWith("touChange", expect.anything());
});

it.each(["disconnected", "_replacedBySocketId"])("does not mutate a late account result after %s", async (flag) => {
  const { socket, handlers } = await session(account({ warnings: [{ acknowledged: false }] }));
  let resolve;
  Account.findOne.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const pending = handlers.acknowledgeWarning();
  socket[flag] = true;
  const loaded = account({ warnings: [{ acknowledged: false }] });
  resolve(loaded);
  await pending;
  expect(loaded.save).not.toHaveBeenCalled();
  expect(loaded.warnings[0].acknowledged).toBe(false);
});

it("handles a repeated warning acknowledgement with no unread warning", async () => {
  const { handlers } = await session(account({ warnings: [{ acknowledged: false }] }));
  const current = account();
  Account.findOne.mockResolvedValueOnce(current);
  await handlers.acknowledgeWarning();
  expect(current.save).not.toHaveBeenCalled();
  expect(current.markModified).not.toHaveBeenCalled();
});

it("persists a warning acknowledgement before removing restrictions", async () => {
  const { socket, handlers } = await session(account({ warnings: [{ acknowledged: false }] }));
  let saved;
  const current = account({
    warnings: [{ acknowledged: false }],
    save: jest.fn(
      () =>
        new Promise((done) => {
          saved = done;
        })
    ),
  });
  Account.findOne.mockResolvedValueOnce(current);
  const pending = handlers.acknowledgeWarning();
  await settle();
  expect(socket.emit).not.toHaveBeenCalledWith("removeAllPopups");
  saved();
  await pending;
  expect(current.warnings[0].acknowledged).toBe(true);
  expect(current.markModified).toHaveBeenCalledWith("warnings");
  expect(socket.emit).toHaveBeenCalledWith("removeAllPopups");
});

it("keeps terms restricted when saving fails and allows a later retry", async () => {
  const { socket, handlers } = await session(account({ touLastAgreed: undefined }));
  const current = account({ touLastAgreed: undefined });
  current.save.mockRejectedValueOnce(new Error("temporary write failure"));
  Account.findOne.mockResolvedValue(current);
  await handlers.confirmTOU();
  expect(socket.emit).not.toHaveBeenCalledWith("removeAllPopups");
  await handlers.confirmTOU();
  expect(current.save).toHaveBeenCalledTimes(2);
  expect(socket.emit).toHaveBeenCalledWith("removeAllPopups");
});

it.each([{}, [], 4, "", "x".repeat(65)])("validates a warnings lookup before reading accounts (%p)", async (name) => {
  const { handlers } = await session(account({ staffRole: "moderator" }));
  await handlers.seeWarnings(name);
  expect(Account.findOne).not.toHaveBeenCalled();
});

it("rechecks the staff role before returning another account's warnings", async () => {
  const { socket, handlers } = await session(account({ staffRole: "moderator" }));
  Account.findOne.mockResolvedValueOnce(account({ staffRole: "" }));
  await handlers.seeWarnings("OtherPlayer");
  expect(Account.findOne).toHaveBeenCalledTimes(1);
  expect(socket.emit).not.toHaveBeenCalledWith("sendWarnings", expect.anything());
});

it("preserves warning review for a current moderator", async () => {
  const { socket, handlers } = await session(account({ staffRole: "moderator" }));
  const warnings = [{ text: "A saved warning", acknowledged: true }];
  Account.findOne
    .mockResolvedValueOnce(account({ staffRole: "moderator" }))
    .mockResolvedValueOnce(account({ warnings }));
  await handlers.seeWarnings("OtherPlayer");
  expect(socket.emit).toHaveBeenCalledWith("sendWarnings", { username: "OtherPlayer", warnings });
});

it.each([
  {},
  { feedback: [] },
  { feedback: 4 },
  { feedback: " " },
  { feedback: "x".repeat(1901) },
])("validates feedback before a database or service request (%p)", async (data) => {
  const { handlers } = await session(account());
  await handlers.feedbackForm(data);
  expect(Account.findOne).not.toHaveBeenCalled();
  expect(https.request).not.toHaveBeenCalled();
});

it("contains feedback persistence and delivery errors", async () => {
  const { socket, handlers } = await session(account());
  const current = account();
  current.save.mockRejectedValueOnce(new Error("temporary write failure"));
  Account.findOne.mockResolvedValueOnce(current);
  await expect(handlers.feedbackForm({ feedback: "Normal feedback" })).resolves.toBeUndefined();
  expect(socket.emit).toHaveBeenCalledWith("sendAlert", expect.stringContaining("Please try again"));
  const onError = request.on.mock.calls.find(([event]) => event === "error")[1];
  expect(() => onError(new Error("delivery failed"))).not.toThrow();
  expect(socket.emit).toHaveBeenCalledWith("feedbackResponse", expect.objectContaining({ status: "error" }));
});

it("requires a session and contains theme-save failures", async () => {
  await handleUpdatedTheme({}, undefined, { backgroundColor: "#ffffff" });
  expect(Account.findOne).not.toHaveBeenCalled();
  const current = account();
  current.save.mockRejectedValueOnce(new Error("temporary write failure"));
  Account.findOne.mockResolvedValueOnce(current);
  await expect(handleUpdatedTheme({}, { user: "Player" }, { backgroundColor: "#ffffff" })).resolves.toBeUndefined();
  expect(console.warn).toHaveBeenCalledWith("Theme update failed:", "Error");
});
