const { buildFixtures, PREFIX } = require("../../scripts/local-testing/fixtures");
const Account = require("../../models/account");
const Profile = require("../../models/profile");
const Game = require("../../models/game");
const GameSummary = require("../../models/game-summary");
const ModAction = require("../../models/modAction");
const PlayerReport = require("../../models/playerReport");
const buildEnhancedGameSummary = require("../../models/game-summary/buildEnhancedGameSummary");
const buildReplay = require("../../src/frontend-scripts/replay/buildReplay").default;
const { CURRENT_SEASON_FIELDS } = require("../../src/shared/season");
const { rankedSeasonEligibility } = require("../../src/shared/ranked-eligibility");
const { obfIP } = require("../../routes/socket/ip-obf");

const now = new Date("2026-11-11T17:00:00Z");
let fixtures;
beforeAll(() => {
  fixtures = buildFixtures({ now });
});

it("provides stable identities, role logins and distinct documentation IPs without generating credentials", () => {
  expect(fixtures.accounts).toHaveLength(30);
  expect(new Set(fixtures.accounts.map((account) => account.signupIP)).size).toBe(30);
  expect(fixtures.accounts.find((account) => account.username === `${PREFIX}Admin`).staffRole).toBe("admin");
  expect(fixtures.accounts.find((account) => account.username === `${PREFIX}Mod`).staffRole).toBe("moderator");
  for (const account of fixtures.accounts) {
    expect(account.username.startsWith(PREFIX)).toBe(true);
    expect(account).not.toHaveProperty("password");
    expect(account).not.toHaveProperty("hash");
    expect(account).not.toHaveProperty("salt");
    expect(account.signupIP).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
    expect(() => obfIP(account.signupIP)).not.toThrow();
  }
  const rerun = buildFixtures({ now });
  expect(rerun).toEqual(fixtures);
});

it("survives all actual model schemas without casting errors", () => {
  for (const [records, Model] of [
    [fixtures.accounts, Account],
    [fixtures.profiles, Profile],
    [fixtures.games, Game],
    [fixtures.summaries, GameSummary],
    [fixtures.modActions, ModAction],
    [fixtures.reports, PlayerReport],
  ]) {
    for (const record of records) expect(new Model(record).validateSync()).toBeUndefined();
  }
});

it("reconstructs every persisted replay to a game-over snapshot and preserves winner partitions", () => {
  expect(fixtures.summaries).toHaveLength(36);
  for (const source of fixtures.summaries) {
    const stored = JSON.parse(JSON.stringify(new GameSummary(source)));
    const enhanced = buildEnhancedGameSummary(stored);
    const replay = buildReplay(enhanced);
    const game = fixtures.games.find((row) => row.uid === source._id);
    expect(replay.size).toBeGreaterThan(10);
    expect(replay.last().gameOver).toBe(true);
    expect(enhanced.winningTeam).toBe(game.winningTeam);
    expect(game.winningPlayers.length + game.losingPlayers.length).toBe(stored.players.length);
    for (const player of game.winningPlayers) expect(enhanced.isWinner(player.userName).value()).toBe(true);
    for (const player of game.losingPlayers) expect(enhanced.isWinner(player.userName).value()).toBe(false);
  }
  expect(fixtures.scenarios.replays).toHaveProperty("veto-eight");
  expect(fixtures.scenarios.replays).toHaveProperty("veto-five");
  expect(fixtures.scenarios.replays).toHaveProperty("silent-neighbor");
  expect(fixtures.scenarios.replays).toHaveProperty("legacy");
});

it("derives profile match counts, recent-game links and ranked counters from the saved games", () => {
  for (const account of fixtures.accounts) {
    const profile = fixtures.profiles.find((row) => row._id === account.username);
    const played = fixtures.games.filter((game) =>
      [...game.winningPlayers, ...game.losingPlayers].some((player) => player.userName === account.username)
    );
    const ranked = played.filter((game) => !game.casualGame && !game.practiceGame && !game.customGame);
    const rankedWins = ranked.filter((game) => game.winningPlayers.some((p) => p.userName === account.username)).length;
    expect(account.wins).toBe(rankedWins);
    expect(account.losses).toBe(ranked.length - rankedWins);
    expect(account[CURRENT_SEASON_FIELDS.wins]).toBe(rankedWins);
    expect(account[CURRENT_SEASON_FIELDS.losses]).toBe(ranked.length - rankedWins);
    expect(account.games).toEqual(ranked.map((game) => game.uid));
    const buckets = Object.values(profile.stats.matches);
    expect(buckets.reduce((sum, row) => sum + row.liberal.events + row.fascist.events, 0)).toBe(played.length);
    expect(profile.recentGames.length).toBe(Math.min(played.length, 10));
    expect(profile.recentGames.map((game) => game._id)).toEqual(
      played
        .slice(-10)
        .reverse()
        .map((game) => game.uid)
    );
    for (const recent of profile.recentGames) {
      const game = played.find((row) => row.uid === recent._id);
      expect(recent.isWinner).toBe(game.winningPlayers.some((player) => player.userName === account.username));
    }
  }
});

it("has a real twenty-game cohort eligible for the season leaderboard and explicit threshold scenarios", () => {
  const qualified = fixtures.accounts.filter((account) => rankedSeasonEligibility(account, now.getTime()).eligible);
  expect(qualified.length).toBeGreaterThanOrEqual(7);
  const account = (name) => fixtures.accounts.find((row) => row.username === name);
  expect(account(fixtures.scenarios.practiceThreshold)).toMatchObject({
    xpOverall: 9,
    xpSeason: 9,
    isRainbowOverall: false,
    isRainbowSeason: false,
    games: [],
  });
  expect(account(fixtures.scenarios.practiceLegacy)).toMatchObject({
    xpOverall: 500,
    isRainbowOverall: false,
    isRainbowSeason: false,
    games: [],
  });
  expect(account(fixtures.scenarios.seasonReset)).toMatchObject({
    xpOverall: 500,
    xpSeason: 0,
    isRainbowOverall: true,
    isRainbowSeason: false,
  });
});

it("includes multiple complete moderation pages and report evidence referring to stored neighbor messages", () => {
  expect(fixtures.modActions).toHaveLength(1500);
  expect(new Set(fixtures.modActions.map((row) => row._id)).size).toBe(1500);
  expect(new Set(fixtures.modActions.map((row) => row.actionTaken)).size).toBeGreaterThan(5);
  expect(fixtures.modActions[0].date.getTime()).toBeLessThan(fixtures.modActions[1499].date.getTime());
  for (const report of fixtures.reports) {
    const game = fixtures.games.find((row) => row.uid === report.gameUid);
    const message = game.neighborChats.find((row) => row.neighborChat.id === report.neighborMessageId);
    expect(message.neighborChat.recipient).toBe(report.reportingPlayer);
    expect(message.neighborChat.sender).toBe(report.reportedPlayer);
    expect(report.neighborChatContext).toEqual(game.neighborChats.slice(0, 2));
  }
});

it.each([NaN, -1, 1.5, 10001])("bounds the fixture request count %s", (modActions) => {
  expect(() => buildFixtures({ modActions })).toThrow(/modActions/);
});

it("accepts zero moderation rows without changing the playable dataset", () => {
  expect(buildFixtures({ now, modActions: 0 }).modActions).toEqual([]);
  expect(() => buildFixtures({ now: new Date(NaN) })).toThrow(/valid date/);
});
