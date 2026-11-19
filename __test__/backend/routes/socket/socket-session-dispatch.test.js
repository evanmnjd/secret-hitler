jest.mock("../../../../routes/socket/user-events", () => ({
  checkUserStatus: jest.fn((socket, ready) => ready()),
}));
jest.mock("../../../../routes/socket/user-requests", () => ({
  sendGeneralChats: jest.fn(),
  sendGameList: jest.fn(),
  sendUserList: jest.fn(),
}));
jest.mock("../../../../routes/socket/bandwidth-diagnostics", () => ({ instrumentSocket: jest.fn() }));
const mongoose = require("mongoose");
const Account = require("../../../../models/account");
const { socketRoutes } = require("../../../../routes/socket/routes");

let socket, middleware;
const originalIO = global.io;
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Account, "find").mockResolvedValue([]);
  jest.spyOn(mongoose.connection, "once").mockImplementation(() => {});
  socket = {
    id: "test-session",
    handshake: { session: {}, headers: {} },
    emit: jest.fn(),
    on: jest.fn(),
    use: jest.fn((handler) => {
      middleware = handler;
    }),
  };
  global.io = { on: jest.fn() };
  socketRoutes();
  global.io.on.mock.calls.find(([event]) => event === "connection")[1](socket);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.io = originalIO;
});

it.each(["_replacedBySocketId", "disconnected"])("drops queued application requests from a %s session", (flag) => {
  socket[flag] = true;
  const next = jest.fn();
  middleware(["getGameList"], next);
  expect(next).not.toHaveBeenCalled();
});

it("continues dispatching requests from the active session", () => {
  const next = jest.fn();
  middleware(["getGameList"], next);
  expect(next).toHaveBeenCalledTimes(1);
});
