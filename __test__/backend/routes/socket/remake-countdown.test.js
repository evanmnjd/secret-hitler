let Account, Game, models, lobbies, checkStartConditions, handleUserLeaveGame, handleSocketDisconnect;
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
    checkStartConditions,
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

const lobby = (count = 7, remake = true) => {
  const game = lobbies.buildNewPlayerLobby("RemadeTable");
  delete game.general.systemLobby;
  if (remake) game.private.isRemakeLobby = true;
  models.games[game.general.uid] = game;
  for (let index = 0; index < count; index++) addSeat(game, `Player${index}`);
  return game;
};

const leave = (game, name) => {
  const socket = global.io.sockets.sockets[name];
  handleUserLeaveGame(socket, game, { uid: game.general.uid }, socket.handshake.session.passport);
};

it.each([
  5, 6, 7,
])("keeps a %i-player remake cancellable for exactly 20 seconds before actual role dealing", async (count) => {
  const game = lobby(count);
  checkStartConditions(game);
  expect(game.general.status).toBe("Game starts in 20 seconds.");
  expect(game.gameState.isStarted).toBeFalsy();
  expect(game.gameState.isTracksFlipped).toBeFalsy();
  jest.advanceTimersByTime(19000);
  expect(game.general.status).toBe("Game starts in 1 second.");
  expect(game.private.seatedPlayers).toBeUndefined();
  expect(game.gameState.isStarted).toBeFalsy();
  jest.advanceTimersByTime(999);
  expect(game.gameState.isTracksFlipped).toBeFalsy();
  jest.advanceTimersByTime(1);
  await settle();
  expect(game.gameState.isStarted).toBe(true);
  expect(game.gameState.isTracksFlipped).toBe(true);
  expect(game.private.seatedPlayers).toHaveLength(count);
  expect(game.private.seatedPlayers.every((player) => player.role && player.playersState)).toBe(true);
  expect(game.private.voteSpamData).toHaveLength(count);
  expect(game.private.summary).toBeDefined();
  expect(game.private.remakeCountdownTimer).toBeUndefined();
  expect(game.remakeData).toHaveLength(count);
});

it("does not restart or skip the timer when the last seats fill", () => {
  const game = lobby(5);
  checkStartConditions(game);
  const timer = game.private.remakeCountdownTimer;
  jest.advanceTimersByTime(10000);
  addSeat(game, "Sixth");
  checkStartConditions(game);
  addSeat(game, "Seventh");
  checkStartConditions(game);
  expect(game.private.remakeCountdownTimer).toBe(timer);
  expect(game.general.status).toBe("Game starts in 10 seconds.");
  jest.advanceTimersByTime(9999);
  expect(game.gameState.isTracksFlipped).toBeFalsy();
  jest.advanceTimersByTime(1);
  expect(game.private.seatedPlayers).toHaveLength(7);
});

it("keeps a partial remake waiting until enough players join", () => {
  const game = lobby(4);
  checkStartConditions(game);
  expect(game.private.remakeCountdownTimer).toBeUndefined();
  expect(game.general.status).toBe("Waiting for 1 more player..");
  jest.advanceTimersByTime(30000);
  expect(game.gameState.isTracksFlipped).toBeFalsy();
  addSeat(game, "Fifth");
  checkStartConditions(game);
  expect(game.general.status).toBe("Game starts in 20 seconds.");
  jest.advanceTimersByTime(19999);
  expect(game.gameState.isTracksFlipped).toBeFalsy();
  jest.advanceTimersByTime(1);
  expect(game.private.seatedPlayers).toHaveLength(5);
});

it("lets a player leave without keeping their seat or committing the game", () => {
  const game = lobby();
  checkStartConditions(game);
  jest.advanceTimersByTime(12000);
  leave(game, "Player0");
  expect(game.publicPlayersState.some((player) => player.userName === "Player0")).toBe(false);
  expect(game.gameState.isStarted).toBeFalsy();
  expect(game.gameState.isTracksFlipped).toBeFalsy();
  jest.advanceTimersByTime(8000);
  expect(game.private.seatedPlayers).toHaveLength(6);
  expect(game.private.seatedPlayers.some((player) => player.userName === "Player0")).toBe(false);
});

it.each([
  "leave",
  "disconnect",
])("cancels below minimum after %s and restarts a full 20 seconds when eligible again", (action) => {
  const game = lobby(5);
  checkStartConditions(game);
  jest.advanceTimersByTime(19000);
  if (action === "leave") leave(game, "Player0");
  else {
    const socket = global.io.sockets.sockets.Player0;
    socket.disconnected = true;
    delete global.io.sockets.sockets.Player0;
    handleSocketDisconnect(socket);
  }
  expect(game.private.remakeCountdownTimer).toBeUndefined();
  expect(game.general.status).toBe("Waiting for 1 more player..");
  addSeat(game, "Replacement");
  checkStartConditions(game);
  expect(game.general.status).toBe("Game starts in 20 seconds.");
  jest.advanceTimersByTime(19999);
  expect(game.gameState.isTracksFlipped).toBeFalsy();
  jest.advanceTimersByTime(1);
  expect(game.private.seatedPlayers).toHaveLength(5);
});

it("waits for a permitted player count and cancels when the roster becomes excluded", () => {
  const game = lobby();
  game.general.excludedPlayerCount = [6];
  checkStartConditions(game);
  jest.advanceTimersByTime(3000);
  leave(game, "Player0");
  expect(game.private.remakeCountdownTimer).toBeUndefined();
  expect(game.general.status).toBe("Waiting for 1 more player..");
  jest.advanceTimersByTime(30000);
  expect(game.gameState.isTracksFlipped).toBeFalsy();
});

it.each(["deleted", "replaced", "teardown"])("never starts a lobby that was %s while counting down", (action) => {
  const game = lobby();
  checkStartConditions(game);
  jest.advanceTimersByTime(19000);
  if (action === "deleted") delete models.games[game.general.uid];
  else if (action === "replaced") models.games[game.general.uid] = { replacement: true };
  else game.isBeingTornDown = true;
  jest.advanceTimersByTime(20000);
  expect(game.gameState.isStarted).toBeFalsy();
  expect(game.private.seatedPlayers).toBeUndefined();
  expect(game.private.remakeCountdownTimer).toBeUndefined();
});

it("pauses a remake countdown while staff have frozen the game", () => {
  const game = lobby();
  checkStartConditions(game);
  jest.advanceTimersByTime(5000);
  game.gameState.isGameFrozen = true;
  jest.advanceTimersByTime(30000);
  expect(game.gameState.isTracksFlipped).toBeFalsy();
  expect(game.general.status).toBe("Game starts in 15 seconds.");
  game.gameState.isGameFrozen = false;
  jest.advanceTimersByTime(15000);
  expect(game.gameState.isTracksFlipped).toBe(true);
});

it("keeps blind-mode names and remake voting initialized at the actual start", () => {
  const game = lobby();
  game.general.blindMode = true;
  checkStartConditions(game);
  jest.advanceTimersByTime(20000);
  expect(game.general.replacementNames).toHaveLength(7);
  expect(new Set(game.general.replacementNames).size).toBe(7);
  expect(game.remakeData.every((player) => player.isRemaking === false && player.remakeTime === 0)).toBe(true);
});

it("preserves the existing fast startup and final countdown for a normal full lobby", () => {
  const game = lobby(7, false);
  checkStartConditions(game);
  expect(game.gameState.isStarted).toBe(true);
  jest.advanceTimersByTime(999);
  expect(game.gameState.isTracksFlipped).toBeFalsy();
  jest.advanceTimersByTime(1);
  expect(game.gameState.isTracksFlipped).toBe(true);
  expect(game.private.seatedPlayers.every((player) => !player.role)).toBe(true);
  jest.advanceTimersByTime(5000);
  expect(game.private.seatedPlayers.every((player) => !player.role)).toBe(true);
  jest.advanceTimersByTime(1000);
  expect(game.private.seatedPlayers.every((player) => player.role)).toBe(true);
});

it("applies the grace period to the actual full-remake handoff", async () => {
  const game = lobby(7, false);
  game.general.playerCount = 7;
  game.gameState = { isStarted: true, isTracksFlipped: true, isCompleted: true };
  game.customGameSettings.fascistCount = 2;
  game.summarySaved = true;
  game.private.seatedPlayers = game.publicPlayersState.map((player) => ({ ...player, gameChats: [] }));
  game.private.policies = ["liberal", "fascist"];
  game.remakeData = game.publicPlayersState.map(({ userName }) => ({
    userName,
    isRemaking: false,
    timesVoted: 0,
    remakeTime: 0,
  }));
  for (const { userName } of game.publicPlayersState) {
    const socket = global.io.sockets.sockets[userName];
    handleUpdatedRemakeGame(socket.handshake.session.passport, game, { remakeStatus: true }, socket);
  }
  jest.advanceTimersByTime(9000);
  await settle();
  const remade = models.games.RemadeTableRemake1;
  expect(remade.private.isRemakeLobby).toBe(true);
  expect(remade.general.status).toBe("Game starts in 20 seconds.");
  expect(remade.gameState.isStarted).toBeFalsy();
  jest.advanceTimersByTime(19999);
  expect(remade.gameState.isTracksFlipped).toBeFalsy();
  jest.advanceTimersByTime(1);
  expect(remade.private.seatedPlayers).toHaveLength(7);
  expect(remade.private.seatedPlayers.every((player) => player.role)).toBe(true);
});
