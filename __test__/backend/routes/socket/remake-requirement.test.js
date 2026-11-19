let Account, Game, models, lobbies, handleUserLeaveGame, handleSocketDisconnect;
let handleUpdatedRemakeGame;
const originalIo = global.io;

beforeAll(() => {
  jest.resetModules();
  jest.useFakeTimers();
  const scheduleInterval = global.setInterval.getMockImplementation();
  global.setInterval.mockImplementation((...args) => {
    const id = scheduleInterval(...args);
    return { [Symbol.toPrimitive]: () => id };
  });
  const redis = require("redis");
  jest.spyOn(redis, "createClient").mockReturnValue({ on: jest.fn(), get: jest.fn(), set: jest.fn() });
  Account = require("../../../../models/account");
  jest.spyOn(Account, "find").mockResolvedValue([]);
  jest
    .spyOn(Account, "findOne")
    .mockImplementation((query) =>
      Promise.resolve({ username: query.username, wins: 10, losses: 10, gameSettings: {} })
    );
  const BannedIP = require("../../../../models/bannedIP");
  jest.spyOn(BannedIP, "deleteMany").mockImplementation((query, callback) => callback(null));
  Game = require("../../../../models/game");
  jest.spyOn(Game, "findOne").mockResolvedValue(null);
  jest.spyOn(Game.prototype, "save").mockResolvedValue();
  models = require("../../../../routes/socket/models");
  lobbies = require("../../../../routes/socket/system-lobbies/new-player");
  ({
    handleUserLeaveGame,
    handleSocketDisconnect,
  } = require("../../../../routes/socket/user-events/leave-game"));
  ({ handleUpdatedRemakeGame } = require("../../../../routes/socket/user-events/remake-game"));
});

const settle = async () => {
  for (let step = 0; step < 10; step++) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  const sockets = {};
  global.io = {
    sockets: {
      sockets,
      connected: sockets,
      adapter: { rooms: {} },
      emit: jest.fn(),
      in: jest.fn().mockReturnValue({ emit: jest.fn() }),
    },
  };
  models.gameCreationDisabled.status = false;
  models.limitNewPlayers.status = false;
});

afterEach(async () => {
  await settle();
  jest.clearAllTimers();
  for (const uid of Object.keys(models.games)) delete models.games[uid];
  models.userList.length = 0;
  global.io = originalIo;
});

afterAll(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const addSeat = (game, userName) => {
  game.publicPlayersState.push({ userName, connected: true, cardStatus: { cardBack: {}, cardFront: "secretrole" } });
  models.userList.push({ userName, status: { type: "none" } });
  const socket = {
    id: userName,
    disconnected: false,
    handshake: { session: { passport: { user: userName } } },
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
  };
  global.io.sockets.sockets[userName] = socket;
  return socket;
};

const sourceGame = ({ completed = true, type = "public", fascistCount = 2 } = {}) => {
  const game = lobbies.buildNewPlayerLobby("SourceGame");
  delete game.general.systemLobby;
  game.general.private = type === "private";
  game.general.playerCount = game.general.minPlayersCount = game.general.maxPlayersCount = 7;
  game.gameState = { isStarted: true, isTracksFlipped: true, isCompleted: completed };
  game.customGameSettings = {
    ...game.customGameSettings,
    enabled: type === "custom",
    fascistCount,
    deckState: { lib: 6, fas: 11 },
    trackState: { lib: 0, fas: 0 },
  };
  game.summarySaved = true;
  game.private.privatePassword = type === "private" ? "local-test-password" : undefined;
  models.games[game.general.uid] = game;
  for (let index = 0; index < 7; index++) addSeat(game, `Player${index}`);
  game.publicPlayersState.forEach((player) => { player.leftGame = false; });
  game.private.seatedPlayers = game.publicPlayersState.map((player) => ({
    ...player,
    role: { team: "liberal", cardName: "liberal" },
    gameChats: [],
  }));
  game.private.policies = ["liberal", "fascist"];
  game.remakeData = game.publicPlayersState.map(({ userName }) => ({
    userName,
    isRemaking: false,
    timesVoted: 0,
    remakeTime: 0,
  }));
  return game;
};

const vote = (game, index, remakeStatus = true) => {
  const socket = global.io.sockets.sockets[`Player${index}`];
  handleUpdatedRemakeGame(socket.handshake.session.passport, game, { remakeStatus }, socket);
};
const depart = (game, index, action) => {
  const socket = global.io.sockets.sockets[`Player${index}`];
  if (action === "disconnect") {
    socket.disconnected = true;
    delete global.io.sockets.sockets[socket.id];
    handleSocketDisconnect(socket);
  } else handleUserLeaveGame(socket, game, { uid: game.general.uid }, socket.handshake.session.passport);
};
const handoff = async () => {
  jest.advanceTimersByTime(3000);
  await settle();
};

it.each([
  ["public", true],
  ["private", "liberal"],
  ["custom", "fascist"],
])("opens a %s post-game remake with one vote and the original vote/reveal delays", async (type, completed) => {
  const game = sourceGame({ type, completed });
  vote(game, 0);
  expect(game.general.isRemaking).toBe(true);
  expect(game.chats[game.chats.length - 1].chat.map((part) => part.text).join("")).toContain("(1/1)");
  jest.advanceTimersByTime(5000);
  expect(game.general.isRemade).toBeFalsy();
  jest.advanceTimersByTime(1000);
  expect(game.general.isRemade).toBe(true);
  jest.advanceTimersByTime(2999);
  expect(models.games.SourceGameRemake1).toBeUndefined();
  jest.advanceTimersByTime(1);
  await settle();
  const remade = models.games.SourceGameRemake1;
  expect(remade.publicPlayersState.map((player) => player.userName)).toEqual(["Player0"]);
  expect(remade.general.private).toBe(type === "private");
  expect(remade.gameState.isStarted).toBeFalsy();
  expect(remade.private).not.toHaveProperty("isRemakeLobby");
  expect(remade.private).not.toHaveProperty("remakeCountdownTimer");
});

it.each([2, undefined])("keeps the active-game quorum when fascist count is %s", (fascistCount) => {
  const game = sourceGame({ completed: false, fascistCount });
  game.customGameSettings.fascistCount = fascistCount;
  for (let index = 0; index < 4; index++) vote(game, index);
  expect(game.general.isRemaking).toBeFalsy();
  vote(game, 4);
  expect(game.general.isRemaking).toBe(true);
});

it("does not lower the tournament cancellation threshold after completion", () => {
  const game = sourceGame();
  game.general.isTourny = true;
  game.general.tournyInfo = { round: 1 };
  vote(game, 0);
  expect(game.general.isRemaking).toBeFalsy();
  expect(game.chats[0].chat.map((part) => part.text).join("")).toContain("(1/5)");
});

it.each(["withdraw", "leave", "disconnect"])("cancels when the only post-game voter chooses %s", async (action) => {
  const game = sourceGame();
  vote(game, 0);
  if (action === "withdraw") {
    jest.advanceTimersByTime(3000);
    // Legacy fake timers do not advance Date.now(), which enforces the vote cooldown.
    game.remakeData[0].remakeTime -= 3000;
    vote(game, 0, false);
  } else depart(game, 0, action);
  expect(game.general.isRemaking).toBe(false);
  jest.advanceTimersByTime(10000);
  await settle();
  expect(models.games.SourceGameRemake1).toBeUndefined();
});

it.each(["leave", "disconnect"])("keeps a post-game remake running when another voter remains after %s", async (action) => {
  const game = sourceGame();
  vote(game, 0);
  vote(game, 1);
  depart(game, 0, action);
  expect(game.general.isRemaking).toBe(true);
  jest.advanceTimersByTime(6000);
  await handoff();
  expect(models.games.SourceGameRemake1.publicPlayersState.map((player) => player.userName)).toEqual(["Player1"]);
});

it("uses the same active-game fallback quorum when a voter disconnects", () => {
  const game = sourceGame({ completed: false });
  game.customGameSettings.fascistCount = undefined;
  for (let index = 0; index < 5; index++) vote(game, index);
  expect(game.general.isRemaking).toBe(true);
  depart(game, 0, "disconnect");
  expect(game.general.isRemaking).toBe(false);
});

it.each(["leave", "disconnect"])("does not carry a voter who departs by %s during the reveal", async (action) => {
  const game = sourceGame();
  vote(game, 0);
  vote(game, 1);
  jest.advanceTimersByTime(6000);
  depart(game, 0, action);
  await handoff();
  expect(models.games.SourceGameRemake1.publicPlayersState.map((player) => player.userName)).toEqual(["Player1"]);
});

it("does not transfer a rescinded voter who reconnects to the old table during the reveal", async () => {
  const game = sourceGame();
  vote(game, 0);
  vote(game, 1);
  jest.advanceTimersByTime(6000);
  depart(game, 0, "leave");
  const player = game.publicPlayersState.find((seat) => seat.userName === "Player0");
  player.leftGame = false;
  player.connected = true;
  await handoff();
  expect(models.games.SourceGameRemake1.publicPlayersState.map((seat) => seat.userName)).toEqual(["Player1"]);
});

it("does not create a ghost lobby if every voter disconnects during the reveal", async () => {
  const game = sourceGame();
  vote(game, 0);
  jest.advanceTimersByTime(6000);
  depart(game, 0, "disconnect");
  await handoff();
  expect(models.games.SourceGameRemake1).toBeUndefined();
});

it("transfers through the current socket when a voter replaces their connection", async () => {
  const game = sourceGame();
  vote(game, 0);
  jest.advanceTimersByTime(6000);
  const old = global.io.sockets.sockets.Player0;
  old._replacedBySocketId = "replacement";
  old.disconnected = true;
  delete global.io.sockets.sockets.Player0;
  const replacement = { ...old, id: "replacement", disconnected: false, _replacedBySocketId: undefined, emit: jest.fn() };
  global.io.sockets.sockets.replacement = replacement;
  await handoff();
  expect(models.games.SourceGameRemake1.publicPlayersState.map((seat) => seat.userName)).toEqual(["Player0"]);
  expect(replacement.emit).toHaveBeenCalledWith("joinGameRedirect", "SourceGameRemake1");
});

it("keeps the original fast start and five-second countdown for a full remade lobby", async () => {
  const game = sourceGame();
  for (let index = 0; index < 7; index++) vote(game, index);
  jest.advanceTimersByTime(9000);
  await settle();
  const remade = models.games.SourceGameRemake1;
  expect(remade.gameState.isStarted).toBe(true);
  expect(remade.gameState.isTracksFlipped).toBeFalsy();
  jest.advanceTimersByTime(1000);
  expect(remade.gameState.isTracksFlipped).toBe(true);
  expect(remade.private.seatedPlayers.every((player) => !player.role)).toBe(true);
  jest.advanceTimersByTime(5000);
  expect(remade.private.seatedPlayers.every((player) => !player.role)).toBe(true);
  jest.advanceTimersByTime(1000);
  expect(remade.private.seatedPlayers.every((player) => player.role)).toBe(true);
});
