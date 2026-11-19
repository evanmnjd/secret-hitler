const { createHash } = require("crypto");
const buildEnhancedGameSummary = require("../../models/game-summary/buildEnhancedGameSummary");
const { profileDelta } = require("../../models/profile/utils");
const { CURRENT_SEASON_NUMBER, CURRENT_SEASON_FIELDS } = require("../../src/shared/season");
const { TOU_CHANGES } = require("../../src/frontend-scripts/node-constants");
const version = require("../../version");

const PREFIX = "LocalDemo";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FIXTURE_VERSION = "local-testing-v1";
const sources = [
  require("../../__test__/mocks/mockGameSummary"),
  require("../../__test__/mocks/p7LiberalWin"),
  require("../../__test__/mocks/p7HitlerKilled"),
];
const veto = require("../../__test__/mocks/veto");
const veto2 = require("../../__test__/mocks/veto2");

const clone = (value) => JSON.parse(JSON.stringify(value));
const objectId = (kind, index) => `5eed${kind}${index.toString(16).padStart(16, "0")}`;
const ipFor = (index, previous = false) =>
  `${["192.0.2", "198.51.100", "203.0.113"][(index + (previous ? 1 : 0)) % 3]}.${index + 10}`;
const zeroMatch = () => ({ liberal: { events: 0, successes: 0 }, fascist: { events: 0, successes: 0 } });

const makeProfile = (account) => ({
  _id: account.username,
  username: account.username,
  version: FIXTURE_VERSION,
  created: account.created,
  bio: account.bio,
  lastConnectedIP: account.lastConnectedIP,
  stats: {
    matches: Object.fromEntries(
      [
        "legacyMatches",
        "greyMatches",
        "rainbowMatches",
        "practiceMatches",
        "silentMatches",
        "emoteMatches",
        "casualMatches",
        "customMatches",
      ].map((type) => [
        type,
        type === "greyMatches" || type === "rainbowMatches"
          ? { ...zeroMatch(), ...Object.fromEntries([5, 6, 7, 8, 9, 10].map((size) => [size, zeroMatch()])) }
          : zeroMatch(),
      ])
    ),
    actions: Object.fromEntries(
      ["voteAccuracy", "shotAccuracy", "legacyVoteAccuracy", "legacyShotAccuracy"].map((key) => [
        key,
        { events: 0, successes: 0 },
      ])
    ),
  },
  recentGames: [],
});

const makeAccount = (username, index, now) => {
  const created = new Date(now.getTime() - (180 + index) * DAY);
  const elo = [2000, 1850, 2100, 1600, 1900][index] ?? 1450 + (index % 9) * 85;
  return {
    username,
    isLocal: true,
    staffRole: ["admin", "moderator", "editor", "trialmod", ""][index] || "",
    isContributor: index === 4,
    verified: true,
    verification: { email: `${username.toLowerCase()}@example.invalid` },
    hasNotDismissedSignupModal: false,
    touLastAgreed: TOU_CHANGES[0].changeVer,
    lastVersionSeen: version.number,
    created,
    lastConnected: new Date(now.getTime() - (index + 1) * HOUR),
    signupIP: ipFor(index),
    lastConnectedIP: ipFor(index),
    ipHistory: [
      { date: created, ip: ipFor(index, true) },
      { date: new Date(now.getTime() - (index + 1) * HOUR), ip: ipFor(index) },
    ],
    bio: `Synthetic local test profile. Display ratings and historical XP are fixture values. Recent game stats come from saved ${PREFIX} replays.`,
    hashUid: createHash("sha256").update(`local-testing:${username}`).digest("hex"),
    gameSettings: {
      soundStatus: "Off",
      disableSeasonal: true,
      enableTimestamps: true,
      notifyForNewLobby: false,
      playerPronouns: index % 2 ? "they/them/theirs" : "",
      staffDisableVisibleElo: false,
      staffDisableVisibleXP: false,
      staffDisableStaffColor: false,
      staffIncognito: false,
      disableElo: false,
      isPrivate: false,
      blacklist: [],
      playerNotes: [],
      tournyWins: [],
    },
    games: [],
    wins: 0,
    losses: 0,
    rainbowWins: 0,
    rainbowLosses: 0,
    [CURRENT_SEASON_FIELDS.wins]: 0,
    [CURRENT_SEASON_FIELDS.losses]: 0,
    [CURRENT_SEASON_FIELDS.rainbowWins]: 0,
    [CURRENT_SEASON_FIELDS.rainbowLosses]: 0,
    eloOverall: elo,
    eloSeason: elo - 40 + (index % 3) * 20,
    maxElo: Math.max(1600, elo + 25),
    xpOverall: index < 5 ? 500 + index * 100 : (index % 7) * 15,
    xpSeason: index < 5 ? 200 + index * 50 : (index % 5) * 5,
    previousDayElo: elo - 20,
    previousDayXP: index < 5 ? 190 + index * 50 : Math.max(0, (index % 5) * 5 - 5),
    eloPercentile: { overall: Math.round((index / 29) * 100), seasonal: Math.round((index / 29) * 100) },
    pastElo: [
      { date: created, value: 1600 },
      { date: new Date(now.getTime() - 7 * DAY), value: elo - 30 },
      { date: new Date(now.getTime() - HOUR), value: elo },
    ],
  };
};

const matchType = (game) => {
  if (game.playerChats === "emotes") return "emoteMatches";
  if (game.customGame) return "customMatches";
  if (game.casualGame) return "casualMatches";
  if (game.playerChats === "disabled") return "silentMatches";
  if (game.practiceGame) return "practiceMatches";
  return game.isRainbow ? "rainbowMatches" : "greyMatches";
};

const addProfileResult = (profile, summary, game) => {
  const delta = profileDelta(profile.username, summary);
  const type = matchType(game);
  for (const loyalty of ["liberal", "fascist"]) {
    for (const counter of ["events", "successes"]) {
      const amount = delta.stats.matches[loyalty][counter];
      profile.stats.matches[type][loyalty][counter] += amount;
      if (type === "greyMatches" || type === "rainbowMatches") {
        profile.stats.matches[type][game.playerCount][loyalty][counter] += amount;
      }
    }
  }
  for (const action of ["voteAccuracy", "shotAccuracy"]) {
    for (const counter of ["events", "successes"]) {
      profile.stats.actions[action][counter] += delta.stats.actions[action][counter];
    }
  }
  profile.recentGames.unshift(delta.recentGames);
  profile.recentGames = profile.recentGames.slice(0, 10);
};

const normalizeSummary = (source, id, date, roster, mode) => {
  const summary = clone(source);
  summary._id = id;
  summary.date = date;
  summary.players = summary.players.map((player, seat) => ({
    username: roster[seat],
    role: player.role,
    icon: seat,
    hashUid: createHash("sha256").update(`local-testing:${roster[seat]}`).digest("hex"),
  }));
  summary.gameSetting = {
    ...summary.gameSetting,
    practiceGame: mode === "practice",
    casualGame: ["neighbor", "silent-neighbor", "emote-neighbor", "casual", "emotes"].includes(mode),
    rebalance7p: mode === "rebalanced",
  };
  summary.customGameSettings = {
    enabled: mode === "custom",
    powers: [null, null, "investigate", "bullet", "bullet"],
    hitlerZone: 3,
    vetoZone: 5,
    fascistCount: summary.players.filter((player) => player.role === "fascist").length,
    deckState: { lib: 6, fas: 11 },
    trackState: { lib: 0, fas: 0 },
  };
  for (const log of summary.logs) {
    delete log._id;
    for (const key of [
      "presidentHand",
      "chancellorHand",
      "presidentClaim",
      "chancellorClaim",
      "policyPeek",
      "policyPeekClaim",
    ]) {
      const hand = log[key];
      if (hand && !Array.isArray(hand) && typeof hand === "object") {
        log[key] = Array(hand.reds || 0)
          .fill("fascist")
          .concat(Array(hand.blues || 0).fill("liberal"));
      }
    }
  }
  if (mode !== "legacy") {
    // The historical source fixtures predate stored decks. Add explicitly synthetic
    // snapshots with the correct per-turn length and any known drawn hand first.
    // They let the existing Show deck control be exercised, not replay a real shuffle.
    const enhanced = buildEnhancedGameSummary(summary);
    summary.logs.forEach((log, index) => {
      const turn = enhanced.turns.get(index);
      const drawn = log.presidentHand || [];
      const reds = Math.max(0, 11 - turn.beforeTrack.reds - drawn.filter((card) => card === "fascist").length);
      const blues = Math.max(0, 6 - turn.beforeTrack.blues - drawn.filter((card) => card === "liberal").length);
      log.deckState = drawn
        .concat(Array(reds).fill("fascist"), Array(blues).fill("liberal"))
        .slice(0, turn.beforeDeckSize);
    });
  }
  return summary;
};

const makeWhisper = (gameIndex, messageIndex, sender, recipient, text, date) => ({
  gameChat: true,
  timestamp: new Date(date.getTime() + messageIndex * 1000),
  chat: [{ text: `Neighbor Chat - ${sender} to ${recipient}: ` }, { text, type: "neighbor-chat" }],
  neighborChat: {
    id: `00000000-0000-4000-8000-${(gameIndex * 10 + messageIndex).toString(16).padStart(12, "0")}`,
    sender,
    recipient,
  },
});

function buildFixtures({ now = new Date(), modActions = 1500 } = {}) {
  now = new Date(now);
  if (!Number.isFinite(now.getTime())) throw new Error("Fixture time must be a valid date.");
  if (!Number.isSafeInteger(modActions) || modActions < 0 || modActions > 10000) {
    throw new Error("modActions must be an integer from 0 to 10000.");
  }
  const usernames = [
    "Admin",
    "Mod",
    "Editor",
    "TrialMod",
    "Contributor",
    ...Array.from({ length: 22 }, (_, index) => `Player${String(index + 1).padStart(2, "0")}`),
    "Practice09",
    "Practice500",
    "SeasonReset",
  ].map((suffix) => PREFIX + suffix);
  const accounts = usernames.map((name, index) => makeAccount(name, index, now));
  const profiles = accounts.map(makeProfile);
  const byUsername = new Map(
    accounts.map((account, index) => [account.username, { account, profile: profiles[index] }])
  );
  const core = [usernames[0], usernames[1], usernames[2], usernames[4], ...usernames.slice(5, 8)];
  const summaries = [];
  const games = [];
  const modes = [
    "neighbor",
    "silent-neighbor",
    "emote-neighbor",
    "practice",
    "silent",
    "veto-eight",
    "veto-five",
    "rebalanced",
    "casual",
    "emotes",
    "legacy",
    "custom",
  ];
  const scenarios = {
    note: "Synthetic local fixtures; saved records are not live lobbies. Rating/XP display baselines and deck snapshots are synthetic.",
    admin: usernames[0],
    moderator: usernames[1],
    player: usernames[5],
    practiceThreshold: usernames[27],
    practiceLegacy: usernames[28],
    seasonReset: usernames[29],
    replays: {},
  };

  for (let index = 0; index < 36; index++) {
    const mode = index < 24 ? (index % 2 ? "ranked-rainbow" : "ranked") : modes[index - 24];
    const source = mode === "veto-eight" ? veto : mode === "veto-five" ? veto2 : sources[index % sources.length];
    const roster =
      index < 24
        ? Array.from({ length: 7 }, (_, seat) => core[(seat + index) % core.length])
        : Array.from({ length: source.players.length }, (_, seat) => usernames[(index * 5 + seat) % 27]);
    const uid = `${PREFIX}Game${String(index + 1).padStart(2, "0")}`;
    const date = new Date(now.getTime() - (36 - index) * 3 * HOUR);
    const summary = normalizeSummary(source, uid, date, roster, mode);
    const enhanced = buildEnhancedGameSummary(summary);
    const neighborChat = mode.includes("neighbor");
    const game = {
      uid,
      name: `Local ${mode} ${index + 1}`,
      date,
      playerChats: mode.startsWith("silent") ? "disabled" : mode.startsWith("emote") ? "emotes" : "enabled",
      neighborChat,
      playerCount: roster.length,
      winningTeam: enhanced.winningTeam,
      winningPlayers: [],
      losingPlayers: [],
      season: CURRENT_SEASON_NUMBER,
      completed: true,
      casualGame: summary.gameSetting.casualGame,
      practiceGame: summary.gameSetting.practiceGame,
      customGame: summary.customGameSettings.enabled,
      isRainbow: mode === "ranked-rainbow",
      rebalance7p: summary.gameSetting.rebalance7p,
      timedMode: index % 2 ? 120 : 0,
      eloMinimum: index % 2 ? 1500 : 0,
      chats: [
        { userName: roster[0], chat: `Synthetic local ${mode} replay.`, timestamp: date },
        {
          gameChat: true,
          chat: [{ text: enhanced.winningTeam === "liberal" ? "Liberals win the game." : "Fascists win the game." }],
          timestamp: new Date(date.getTime() + 5 * 60 * 1000),
        },
      ],
      neighborChats: neighborChat
        ? [
            makeWhisper(
              index,
              1,
              roster[0],
              roster[1],
              "Hello right neighbor. This is a saved local test message.",
              date
            ),
            makeWhisper(
              index,
              2,
              roster[1],
              roster[0],
              "Reply from your neighbor. Test the replay whisper filter.",
              date
            ),
            makeWhisper(
              index,
              3,
              roster[3],
              roster[4],
              "A second pair's archived conversation appears in public replays.",
              date
            ),
          ]
        : [],
      hiddenInfoChat: [
        {
          gameChat: true,
          chat: [{ text: "Synthetic moderator-only evidence; this is not an ordinary public chat." }],
          timestamp: date,
        },
      ],
    };
    const ranked = !game.casualGame && !game.practiceGame && !game.customGame;
    for (const username of roster) {
      const { account, profile } = byUsername.get(username);
      const won = enhanced.isWinner(username).value();
      const loyalty = enhanced.loyaltyOf(username).value();
      const entry = { userName: username, team: loyalty, role: enhanced.roleOf(username).value() };
      game[won ? "winningPlayers" : "losingPlayers"].push(entry);
      addProfileResult(profile, enhanced, game);
      account.lastCompletedGame = date;
      account.xpOverall += won ? 2 : 1;
      account.xpSeason += won ? 2 : 1;
      if (ranked) {
        const counter = won ? "wins" : "losses";
        account[counter]++;
        account[CURRENT_SEASON_FIELDS[counter]]++;
        if (game.isRainbow) {
          const rainbowCounter = won ? "rainbowWins" : "rainbowLosses";
          account[rainbowCounter]++;
          account[CURRENT_SEASON_FIELDS[rainbowCounter]]++;
        }
        account.games.push(uid);
        account.lastRankedGameAt = date;
      }
    }
    summaries.push(summary);
    games.push(game);
    if (!(mode in scenarios.replays)) scenarios.replays[mode] = uid;
  }

  for (const account of accounts) {
    account.isRainbowOverall = account.xpOverall >= 10;
    account.isRainbowSeason = account.xpSeason >= 10;
    if (account.isRainbowOverall) {
      account.dateRainbowOverall = new Date(now.getTime() - 7 * DAY + accounts.indexOf(account) * HOUR);
    }
    account.badges = account.xpOverall >= 10 ? [{ id: "xp10", text: "10", dateAwarded: account.created }] : [];
  }
  Object.assign(accounts[27], {
    xpOverall: 9,
    xpSeason: 9,
    isRainbowOverall: false,
    isRainbowSeason: false,
    badges: [],
  });
  Object.assign(accounts[28], {
    xpOverall: 500,
    xpSeason: 500,
    isRainbowOverall: false,
    isRainbowSeason: false,
    badges: [],
  });
  delete accounts[27].dateRainbowOverall;
  delete accounts[28].dateRainbowOverall;
  Object.assign(accounts[29], { xpOverall: 500, xpSeason: 0, isRainbowOverall: true, isRainbowSeason: false });
  accounts[27].bio =
    "Local practice test: 9 lifetime and seasonal XP, no Rainbow. Finish a Practice game to cross the threshold.";
  accounts[28].bio =
    "Local legacy test: deliberately stale Rainbow flags at 500 XP. A Practice completion should repair them.";
  accounts[29].bio = "Local season-reset test: lifetime Rainbow and 500 XP, zero seasonal XP and no seasonal Rainbow.";
  for (const profile of profiles) profile.bio = byUsername.get(profile.username).account.bio;

  const actions = ["comment", "getIP", "warn", "ban", "ipban", "clearTimeout", "removeWarning", "togglePrivate"];
  const modActionRows = Array.from({ length: modActions }, (_, index) => ({
    _id: objectId("0001", index + 1),
    date: new Date(now.getTime() - (modActions - index) * HOUR),
    modUserName: usernames[index % 4],
    userActedOn: usernames[(index * 7) % usernames.length],
    ip: index % 17 ? accounts[(index * 7) % accounts.length].signupIP : "",
    actionTaken: actions[index % actions.length],
    modNotes: `${PREFIX} seed note ${index + 1}${index % 5 === 0 ? "\nSynthetic history; no action was performed." : ""}`,
  }));
  const neighborGame = games.find((game) => game.neighborChat);
  const reported = neighborGame.neighborChats[0];
  const reports = [
    {
      _id: objectId("0002", 1),
      date: new Date(neighborGame.date.getTime() + 10 * 60 * 1000),
      gameUid: neighborGame.uid,
      reportedPlayer: reported.neighborChat.sender,
      reportingPlayer: reported.neighborChat.recipient,
      reason: "Abusive Chat",
      gameType: "Neighbor Chat",
      comment: "Synthetic report for testing the saved neighbor evidence panel.",
      isActive: true,
      neighborMessageId: reported.neighborChat.id,
      neighborChatContext: neighborGame.neighborChats.slice(0, 2),
    },
  ];
  return { accounts, profiles, games, summaries, modActions: modActionRows, reports, scenarios };
}

module.exports = { PREFIX, FIXTURE_VERSION, buildFixtures };
