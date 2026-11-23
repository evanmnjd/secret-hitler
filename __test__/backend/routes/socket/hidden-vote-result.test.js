jest.mock("../../../../routes/socket/util", () => ({
  sendInProgressGameUpdate: jest.fn(),
  sendInProgressModChatUpdate: jest.fn(),
  gameReportHeader: jest.fn(),
}));
jest.mock("../../../../routes/socket/user-requests", () => ({ sendGameList: jest.fn() }));
jest.mock("../../../../routes/socket/report", () => ({ makeReport: jest.fn() }));
jest.mock("../../../../routes/socket/game/end-game", () => ({ completeGame: jest.fn() }));

const { selectVoting } = require("../../../../routes/socket/game/election");
const { selectChancellor } = require("../../../../routes/socket/game/election-util");
const { sendInProgressGameUpdate } = require("../../../../routes/socket/util");

const counts = [5, 6, 7, 8, 9, 10];
const makeGame = (size = 7, general = {}, dead = []) => {
  const deadSeats = new Set(dead);
  const players = Array.from({ length: size }, (_, seat) => ({
    userName: `Player${seat + 1}`,
    isDead: deadSeats.has(seat),
    connected: true,
    voteStatus: { hasVoted: true, didVoteYes: seat % 3 !== 1 },
    gameChats: [],
    cardFlingerState: [],
  }));
  const last = players.filter((player) => !player.isDead).slice(-1)[0];
  last.voteStatus.hasVoted = false;
  return {
    general: {
      uid: "hidden-vote-table",
      playerCount: size,
      livingPlayerCount: size - deadSeats.size,
      noVoteReveal: true,
      experiencedMode: false,
      disableGamechat: false,
      status: "Vote",
      ...general,
    },
    gameState: { phase: "voting" },
    publicPlayersState: players.map((player) => ({
      userName: player.userName,
      isDead: player.isDead,
      cardStatus: { cardBack: { cardName: "secret" }, isFlipped: false },
    })),
    private: {
      seatedPlayers: players,
      summary: { updateLog: jest.fn().mockReturnThis() },
      lock: {},
      unSeatedGameChats: [],
      voteSpamData: players.map(() => ({ unvoteTimer: -1 })),
    },
  };
};
const lastLiving = (game) => game.private.seatedPlayers.filter((player) => !player.isDead).slice(-1)[0];
const submitLast = (game, force = false) => {
  const player = lastLiving(game);
  selectVoting({ user: player.userName }, game, { vote: player.voteStatus.didVoteYes }, null, force);
};
const revealDelay = (game) => (game.general.experiencedMode ? 2500 : 3000);
const result = (game) => game.private.unSeatedGameChats.find((entry) => entry.chat?.[0]?.type === "vote-result");
const expectAnonymousResult = (game) => {
  const entry = result(game);
  const living = game.private.seatedPlayers.filter((player) => !player.isDead);
  const ja = living.filter((player) => player.voteStatus.didVoteYes).length;
  const nein = living.length - ja;
  expect(entry).toEqual({
    timestamp: expect.any(Date),
    gameChat: true,
    chat: [{ text: `Vote result: ${ja} Ja · ${nein} Nein`, type: "vote-result", ja, nein }],
  });
  for (const player of game.private.seatedPlayers) expect(player.gameChats).toEqual([entry]);
  expect(game.private.unSeatedGameChats).toEqual([entry]);
  expect(game.publicPlayersState.every((player) => !player.cardStatus.isFlipped)).toBe(true);
  expect(game.publicPlayersState.map((player) => player.cardStatus.cardBack.cardName)).toEqual(
    game.publicPlayersState.map(() => "secret")
  );
  expect(game.private.summary.updateLog).toHaveBeenCalledWith({
    votes: game.private.seatedPlayers.map((player) => player.voteStatus.didVoteYes),
  });
  expect(sendInProgressGameUpdate).toHaveBeenLastCalledWith(game, false);
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each(counts)("publishes only aggregate counts after the reveal delay for %i players", (size) => {
  const game = makeGame(size);
  submitLast(game);
  expect(result(game)).toBeUndefined();
  jest.advanceTimersByTime(revealDelay(game) - 1);
  expect(result(game)).toBeUndefined();
  jest.advanceTimersByTime(1);
  expectAnonymousResult(game);
});

it.each(
  counts.flatMap((size) => [0, Math.floor(size / 2), size - 1].map((seat) => [size, seat]))
)("excludes a dead player in a %i-player game's seat %i from both counts", (size, deadSeat) => {
  const game = makeGame(size, {}, [deadSeat]);
  submitLast(game);
  jest.advanceTimersByTime(revealDelay(game));
  expectAnonymousResult(game);
  const segment = result(game).chat[0];
  expect(segment.ja + segment.nein).toBe(size - 1);
});

const modes = [
  ["normal chat", {}],
  ["experienced", { experiencedMode: true }],
  ["game chat disabled", { disableGamechat: true }],
  ["silent", { playerChats: "disabled" }],
  ["emotes only", { playerChats: "emotes" }],
  ["blind", { blindMode: true }],
  ["neighbor chat", { neighborChat: true }],
  ["timed", { timedMode: 30 }],
  ["custom", { customGame: true }],
  ["practice", { practiceGame: true }],
  ["rainbow", { rainbowgame: true }],
  ["monarchist", { monarchistSH: true }],
  ["Avalon", { avalonSH: { withPercival: true } }],
  ["tournament game", { isTourny: true, tournyInfo: { isCancelled: false } }],
  [
    "all compatible flags",
    {
      experiencedMode: true,
      disableGamechat: true,
      playerChats: "disabled",
      blindMode: true,
      neighborChat: true,
      timedMode: 30,
      customGame: true,
      practiceGame: true,
      monarchistSH: true,
      avalonSH: { withPercival: true },
      isTourny: true,
      tournyInfo: { isCancelled: false },
    },
  ],
];
it.each(
  counts.flatMap((size) => modes.map(([label, flags]) => [size, label, flags]))
)("keeps results available for %i players in %s mode", (size, _label, flags) => {
  const game = makeGame(size, flags);
  submitLast(game);
  jest.advanceTimersByTime(revealDelay(game));
  expectAnonymousResult(game);
});

it("waits for every living ballot before publishing any result", () => {
  const game = makeGame();
  const first = game.private.seatedPlayers[0];
  first.voteStatus.hasVoted = false;
  submitLast(game);
  jest.advanceTimersByTime(3000);
  expect(result(game)).toBeUndefined();
  selectVoting({ user: first.userName }, game, { vote: true }, null);
  jest.advanceTimersByTime(3000);
  expectAnonymousResult(game);
});

it("includes a disconnected living player's forced ballot in the anonymous totals", () => {
  const game = makeGame(7, { timedMode: 30 });
  const player = lastLiving(game);
  player.connected = false;
  player.leftGame = true;
  submitLast(game, true);
  jest.advanceTimersByTime(revealDelay(game));
  expectAnonymousResult(game);
});

it.each([true, false])("supports a unanimous %s ballot without changing the totals", (vote) => {
  const game = makeGame();
  game.private.seatedPlayers.forEach((player) => {
    player.voteStatus.didVoteYes = vote;
  });
  submitLast(game);
  jest.advanceTimersByTime(revealDelay(game));
  expectAnonymousResult(game);
});

it("leaves ordinary visible ballot games unchanged", () => {
  const game = makeGame(7, { noVoteReveal: false });
  submitLast(game);
  jest.advanceTimersByTime(revealDelay(game));
  expect(result(game)).toBeUndefined();
  expect(game.private.unSeatedGameChats).toEqual([]);
  for (const [seat, player] of game.publicPlayersState.entries()) {
    expect(player.cardStatus.isFlipped).toBe(true);
    expect(player.cardStatus.cardBack.cardName).toBe(
      game.private.seatedPlayers[seat].voteStatus.didVoteYes ? "ja" : "nein"
    );
  }
  expect(sendInProgressGameUpdate).toHaveBeenLastCalledWith(game, true);
});

it.each(
  [5, 7, 10].flatMap((size) =>
    [true, false].flatMap((noVoteReveal) =>
      [true, false].map((disableGamechat) => [size, noVoteReveal, disableGamechat])
    )
  )
)("allows the next nomination after a failed %i-player election (hidden votes %s, game chat disabled %s)", (size, noVoteReveal, disableGamechat) => {
  const game = makeGame(size, { noVoteReveal, disableGamechat, electionCount: 1 });
  Object.assign(game.gameState, {
    presidentIndex: 0,
    pendingChancellorIndex: 1,
    previousElectedGovernment: [],
    undrawnPolicyCount: 10,
  });
  game.trackState = { electionTrackerCount: 0, fascistPolicyCount: 0, consecutiveTopdecks: 0 };
  game.customGameSettings = { vetoZone: 5 };
  game.private.policies = Array(10).fill("liberal");
  game.private.summary.nextTurn = jest.fn().mockReturnThis();
  for (const player of game.private.seatedPlayers) {
    player.voteStatus.didVoteYes = false;
    player.playersState = Array.from({ length: size }, () => ({ notificationStatus: "" }));
  }
  submitLast(game);
  // Reveal the unanimous Nein ballot, finish its failed-election delay, then start the next government.
  jest.advanceTimersByTime(revealDelay(game) + 1500 + 2000);
  expect(game.trackState.electionTrackerCount).toBe(1);
  expect(game.gameState.phase).toBe("selectingChancellor");
  expect(game.gameState.presidentIndex).toBe(1);
  expect(game.gameState.pendingChancellorIndex).toBeNull();

  selectChancellor(null, { user: game.private.seatedPlayers[1].userName }, game, { chancellorIndex: 2 });
  expect(game.gameState.phase).toBe("voting");
  expect(game.gameState.pendingChancellorIndex).toBe(2);
  expect(game.private.summary.updateLog).toHaveBeenCalledWith({ chancellorId: 2 });
});
