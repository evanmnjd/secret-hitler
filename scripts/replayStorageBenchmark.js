// Offline measurement only: does not connect to Mongo or modify stored replays.
const mongoose = require("mongoose");
const Game = require("../models/game");
const GameSummary = require("../models/game-summary");
// Use the BSON implementation bundled with our existing Mongo driver, not a new codec.
const BSON = require(require.resolve("bson", { paths: [require.resolve("mongodb")] }));
const bson = new BSON();

const OPTIONAL_ARRAYS = [
  "presidentHand",
  "chancellorHand",
  "presidentClaim",
  "chancellorClaim",
  "policyPeek",
  "policyPeekClaim",
];

const legacyModel = () => {
  if (mongoose.models.LegacyReplayStorageBenchmark) return mongoose.models.LegacyReplayStorageBenchmark;
  // Mongoose 5's parent schema clone shares nested schemas. Construct independent
  // definitions so the benchmark cannot change the production model's defaults.
  const logs = { ...GameSummary.schema.path("logs").schema.obj };
  for (const field of OPTIONAL_ARRAYS) logs[field] = { type: Array, default: () => [] };
  const schema = new mongoose.Schema({
    ...GameSummary.schema.obj,
    players: [{ ...GameSummary.schema.path("players").schema.obj }],
    logs: [logs],
    gameSetting: {
      ...GameSummary.schema.obj.gameSetting,
      avalonSH: { type: { withPercival: Boolean }, default: null },
    },
  });
  return mongoose.model("LegacyReplayStorageBenchmark", schema);
};

// Historical fixtures use counted hands. Normalize them to today's policy arrays before casting.
const currentSummary = (fixture) => ({
  ...fixture,
  date: new Date("2026-11-10T12:00:00.000Z"),
  players: fixture.players.map(({ _id, ...player }) => player),
  logs: fixture.logs.map(({ _id, ...log }) => {
    const result = { ...log };
    for (const field of OPTIONAL_ARRAYS) {
      const hand = result[field];
      if (hand && !Array.isArray(hand) && Number.isInteger(hand.reds) && Number.isInteger(hand.blues)) {
        result[field] = Array(hand.reds).fill("fascist").concat(Array(hand.blues).fill("liberal"));
      }
    }
    return result;
  }),
});

const archiveFixture = (summary) =>
  new Game({
    _id: new mongoose.Types.ObjectId("000000000000000000000001"),
    uid: summary._id,
    date: summary.date,
    completed: true,
    playerCount: summary.players.length,
    winningTeam: "liberal",
    winningPlayers: summary.players.filter((player) => player.role === "liberal"),
    losingPlayers: summary.players.filter((player) => player.role !== "liberal"),
    chats: Array.from({ length: 200 }, (_, index) => ({
      userName: summary.players[index % summary.players.length].username,
      timestamp: new Date(summary.date.getTime() + index * 1000),
      chat: `Message ${index}: a representative public discussion of the last vote, policy claim and next nomination.`,
    })),
  }).toObject();

const measure = (label, fixture) => {
  const summary = currentSummary(fixture);
  const before = new (legacyModel())(summary).toObject();
  const after = new GameSummary(summary).toObject();
  const archive = archiveFixture(summary);
  const beforeSummaryBytes = bson.calculateObjectSize(before);
  const afterSummaryBytes = bson.calculateObjectSize(after);
  const archiveBytes = bson.calculateObjectSize(archive);
  return {
    label,
    players: summary.players.length,
    turns: summary.logs.length,
    beforeSummaryBytes,
    afterSummaryBytes,
    bytesSaved: beforeSummaryBytes - afterSummaryBytes,
    summaryPercentSaved: Number(((1 - afterSummaryBytes / beforeSummaryBytes) * 100).toFixed(2)),
    archiveBytes,
    combinedPercentSaved: Number(
      (((beforeSummaryBytes - afterSummaryBytes) / (beforeSummaryBytes + archiveBytes)) * 100).toFixed(2)
    ),
  };
};

const run = () => {
  const generic = require("../__test__/mocks/mockGameSummary");
  const veto = require("../__test__/mocks/veto");
  const long = {
    ...generic,
    _id: "synthetic-long-ten-player",
    players: Array.from({ length: 10 }, (_, index) => ({
      username: `Player${index + 1}`,
      role: index === 9 ? "hitler" : index >= 6 ? "fascist" : "liberal",
    })),
    // A storage shape stress fixture, not a production gameplay/balance observation.
    logs: Array.from({ length: 30 }, (_, index) => ({
      presidentId: index % 10,
      chancellorId: (index + 1) % 10,
      votes: Array(10).fill(index % 3 === 2),
      ...(index % 3 === 2
        ? { presidentHand: ["fascist", "fascist", "liberal"], chancellorHand: ["fascist", "liberal"] }
        : {}),
    })),
  };
  return [
    measure("7p historical fixture", generic),
    measure("8p historical veto fixture", veto),
    measure("10p synthetic long shape", long),
  ];
};

if (require.main === module) console.log(JSON.stringify(run(), null, 2));

module.exports = { currentSummary, legacyModel, measure, run };
