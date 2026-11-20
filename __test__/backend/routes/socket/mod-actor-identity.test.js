jest.mock("../../../../models/modAction", () => {
  const Model = jest.fn(function (data) {
    Object.assign(this, data);
    this.save = jest.fn().mockResolvedValue(this);
  });
  Model.findOne = jest.fn();
  return Model;
});
jest.mock("../../../../routes/socket/util", () => ({ sendInProgressGameUpdate: jest.fn() }));

const ModAction = require("../../../../models/modAction");
const {
  handleGameFreeze,
  handleModPeekVotes,
  handleModPeekRemakes,
} = require("../../../../routes/socket/user-events/mod-modals");

const handlers = [handleGameFreeze, handleModPeekVotes, handleModPeekRemakes];
const makeGame = (name) => ({
  general: { uid: "table" },
  private: { seatedPlayers: [{ userName: name, role: { cardName: "liberal" } }] },
  gameState: {},
  chats: [],
});
beforeEach(() => jest.clearAllMocks());

it.each(handlers)("uses the session actor for the seated-player restriction (%p)", (handler) => {
  const socket = { emit: jest.fn() };
  const game = makeGame("SeatedStaff");
  handler(socket, { user: "SeatedStaff" }, game, "DifferentName");
  expect(socket.emit).toHaveBeenCalledWith("sendAlert", expect.stringContaining("whilst playing"));
  expect(ModAction).not.toHaveBeenCalled();
  expect(game.chats).toEqual([]);
  expect(game.gameState.isGameFrozen).toBeUndefined();
});

it.each(handlers)("retains observer staff actions and records the authenticated actor (%p)", (handler) => {
  const socket = { emit: jest.fn() };
  const game = makeGame("Player");
  handler(socket, { user: "ObserverStaff" }, game, "DifferentName");
  expect(ModAction).toHaveBeenCalledWith(expect.objectContaining({ modUserName: "ObserverStaff" }));
  if (handler === handleGameFreeze) {
    expect(game.chats[0].userName).toBe("(Staff) ObserverStaff");
    expect(game.gameState.isGameFrozen).toBeInstanceOf(Date);
  } else {
    expect(socket.emit).toHaveBeenCalledWith("sendAlert", expect.stringContaining("<table"));
  }
});

it.each(handlers)("requires an authenticated actor before changing staff state (%p)", (handler) => {
  const socket = { emit: jest.fn() };
  const game = makeGame("Player");
  handler(socket, undefined, game, "ObserverStaff");
  expect(ModAction).not.toHaveBeenCalled();
  expect(socket.emit).not.toHaveBeenCalled();
  expect(game.chats).toEqual([]);
});
