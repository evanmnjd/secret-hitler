const { EventEmitter } = require("events");

let mongoose, Account, Game, models, lobbies, socketRoutes;
let handleUpdatedRemakeGame, handleUserLeaveGame, handleSocketDisconnect;
let connectionSpy;
const originalIo = global.io;

beforeAll(() => {
  jest.resetModules();
  jest.useFakeTimers();
  // Production converts Node Timeout handles to IDs; Jest 24 supplies numeric IDs.
  const scheduleInterval = global.setInterval.getMockImplementation();
  global.setInterval.mockImplementation((...args) => {
    const id = scheduleInterval(...args);
    return { [Symbol.toPrimitive]: () => id };
  });
  const redis = require("redis");
  jest.spyOn(redis, "createClient").mockReturnValue({
    on: jest.fn(),
    get: jest.fn((key, callback) => callback(null, "null")),
    set: jest.fn(),
  });
  mongoose = require("mongoose");
  Account = require("../../../../models/account");
  jest.spyOn(Account, "find").mockResolvedValue([]);
  const BannedIP = require("../../../../models/bannedIP");
  jest.spyOn(BannedIP, "deleteMany").mockImplementation((query, callback) => callback(null));
  Game = require("../../../../models/game");
  jest.spyOn(Game, "findOne").mockResolvedValue(null);
  jest.spyOn(Game.prototype, "save").mockResolvedValue();
  jest
    .spyOn(Account, "findOne")
    .mockImplementation((query) =>
      Promise.resolve({ username: query.username, wins: 10, losses: 10, gameSettings: {} })
    );
  models = require("../../../../routes/socket/models");
  lobbies = require("../../../../routes/socket/system-lobbies/new-player");
  ({ socketRoutes } = require("../../../../routes/socket/routes"));
  ({ handleUpdatedRemakeGame } = require("../../../../routes/socket/user-events/remake-game"));
  ({ handleUserLeaveGame, handleSocketDisconnect } = require("../../../../routes/socket/user-events/leave-game"));
});

const settle = async () => {
  for (let step = 0; step < 12; step++) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  const sockets = {};
  global.io = {
    on: jest.fn(),
    sockets: {
      sockets,
      connected: sockets,
      adapter: { rooms: {} },
      emit: jest.fn(),
      in: jest.fn().mockReturnValue({ emit: jest.fn() }),
    },
  };
  const connection = new EventEmitter();
  connection.readyState = 0;
  connectionSpy = jest.spyOn(mongoose, "connection", "get").mockReturnValue(connection);
  models.gameCreationDisabled.status = false;
  models.limitNewPlayers.status = false;
  models.gameListEmitter.send = false;
  models.gameListEmitter.state = 0;
});

afterEach(async () => {
  await settle();
  jest.clearAllTimers();
  for (const uid of Object.keys(models.games)) delete models.games[uid];
  models.userList.length = 0;
  connectionSpy.mockRestore();
  global.io = originalIo;
});

afterAll(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const connect = (userName, id = userName) => {
  const socket = {
    id,
    connected: true,
    disconnected: false,
    handshake: { session: { passport: { user: userName } } },
    emit: jest.fn(),
    join: jest.fn((uid) => {
      const rooms = global.io.sockets.adapter.rooms;
      rooms[uid] = rooms[uid] || { sockets: {} };
      rooms[uid].sockets[id] = true;
    }),
    leave: jest.fn((uid) => {
      const room = global.io.sockets.adapter.rooms[uid];
      if (room) delete room.sockets[id];
    }),
  };
  global.io.sockets.sockets[id] = socket;
  if (!models.userList.some((user) => user.userName === userName)) {
    models.userList.push({ userName, status: { type: "none" } });
  }
  return socket;
};

const startedGame = (type = "public") => {
  const game = lobbies.buildNewPlayerLobby("SourceGame");
  if (type !== "New Player") delete game.general.systemLobby;
  game.general.private = type === "private";
  game.private.privatePassword = type === "private" ? "local-test-password" : undefined;
  game.general.playerCount = 5;
  game.gameState.isStarted = true;
  game.gameState.isTracksFlipped = true;
  game.summarySaved = true;
  game.publicPlayersState = Array.from({ length: 5 }, (_, index) => ({
    userName: `Player${index}`,
    connected: true,
    leftGame: false,
    cardStatus: { cardBack: {}, cardFront: "secretrole" },
  }));
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
  models.games[game.general.uid] = game;
  for (const player of game.publicPlayersState) connect(player.userName).join(game.general.uid);
  const intake = lobbies.buildNewPlayerLobby("WaitingIntake");
  models.games[intake.general.uid] = intake;
  return { game, intake };
};

const beginRemake = async (game, votes = 4) => {
  for (let index = 0; index < votes; index++) {
    const socket = global.io.sockets.sockets[`Player${index}`];
    handleUpdatedRemakeGame(socket.handshake.session.passport, game, { remakeStatus: true }, socket);
  }
  jest.advanceTimersByTime(6000);
  await settle();
  expect(game.general.isRemade).toBe(true);
  expect(models.games.SourceGameRemake1).toBeUndefined();
};

const depart = (game, userName, action) => {
  const socket = Object.values(global.io.sockets.sockets).find(
    (candidate) => candidate.handshake.session.passport.user === userName
  );
  socket.leave(game.general.uid);
  if (action === "disconnect") {
    socket.connected = false;
    socket.disconnected = true;
    delete global.io.sockets.sockets[socket.id];
    handleSocketDisconnect(socket);
  } else {
    handleUserLeaveGame(socket, game, { uid: game.general.uid }, socket.handshake.session.passport);
  }
};

const finishHandoff = async () => {
  jest.advanceTimersByTime(3000);
  await settle();
};

describe("remake handoff liveness", () => {
  it.each([
    ["New Player", "leave"],
    ["New Player", "disconnect"],
    ["public", "leave"],
    ["public", "disconnect"],
    ["private", "leave"],
    ["private", "disconnect"],
  ])("does not carry a departed voter into a %s remake after %s", async (type, action) => {
    const { game, intake } = startedGame(type);
    await beginRemake(game);
    depart(game, "Player0", action);
    await finishHandoff();
    const target = models.games.SourceGameRemake1;
    expect(target).toBeDefined();
    expect(target.publicPlayersState.map((player) => player.userName).sort()).toEqual([
      "Player1",
      "Player2",
      "Player3",
    ]);
    expect(target.publicPlayersState.every((player) => player.connected && !player.leftGame)).toBe(true);
    expect(target.general.private).toBe(type === "private");
    expect(target.gameState.isTracksFlipped).toBeFalsy();
    expect(models.games.WaitingIntake).toBe(intake);
    expect(Object.values(models.games).filter(lobbies.shouldSurviveEmptyPregame)).toEqual([intake]);
  });

  it.each(["leave", "disconnect"])("does not publish a ghost lobby when every voter departs by %s", async (action) => {
    const { game, intake } = startedGame("New Player");
    await beginRemake(game, 5);
    for (const { userName } of game.publicPlayersState) depart(game, userName, action);
    await finishHandoff();
    expect(models.games.SourceGameRemake1).toBeUndefined();
    expect(models.games.WaitingIntake).toBe(intake);
    expect(Object.values(models.games).filter(lobbies.shouldSurviveEmptyPregame)).toEqual([intake]);
  });

  it("redirects a reconnecting voter through their current socket at handoff", async () => {
    const { game } = startedGame();
    await beginRemake(game);
    const replaced = global.io.sockets.sockets.Player0;
    replaced._replacedBySocketId = "Player0Replacement";
    replaced.connected = false;
    replaced.disconnected = true;
    delete global.io.sockets.sockets.Player0;
    handleSocketDisconnect(replaced);
    const replacement = connect("Player0", "Player0Replacement");
    replaced.emit.mockClear();
    await finishHandoff();
    expect(models.games.SourceGameRemake1.publicPlayersState.map((player) => player.userName).sort()).toEqual([
      "Player0",
      "Player1",
      "Player2",
      "Player3",
    ]);
    expect(replacement.emit).toHaveBeenCalledWith("joinGameRedirect", "SourceGameRemake1");
    expect(replacement.join).toHaveBeenCalledWith("SourceGameRemake1");
    expect(replaced.emit).not.toHaveBeenCalledWith("joinGameRedirect", expect.anything());
  });
});

describe("old remade cohort cleanup", () => {
  it.each([
    ["New Player", "leave"],
    ["New Player", "disconnect"],
    ["public", "leave"],
    ["public", "disconnect"],
    ["private", "leave"],
    ["private", "disconnect"],
  ])("collects a %s source after its remaining player %s, retaining target and intake", async (type, action) => {
    const { game, intake } = startedGame(type);
    await beginRemake(game);
    await finishHandoff();
    const target = models.games.SourceGameRemake1;
    expect(models.games.SourceGame).toBe(game);
    expect(game.publicPlayersState.filter((player) => !player.leftGame).map((player) => player.userName)).toEqual([
      "Player4",
    ]);
    depart(game, "Player4", action);
    game.general.timeAbandoned = new Date(Date.now() - 300000);
    socketRoutes();
    jest.advanceTimersByTime(30000);
    await settle();
    expect(models.games.SourceGame).toBeUndefined();
    expect(models.games.SourceGameRemake1).toBe(target);
    expect(target.publicPlayersState).toHaveLength(4);
    expect(models.games.WaitingIntake).toBe(intake);
    expect(Game.prototype.save).toHaveBeenCalled();
  });
});
