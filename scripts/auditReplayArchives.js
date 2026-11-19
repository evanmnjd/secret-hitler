// Explicit, bounded and read-only. No archive audits or migrations run at application startup.
const mongoose = require("mongoose");
const Game = require("../models/game");
const GameSummary = require("../models/game-summary");
const auditArchive = require("../models/game-summary/auditArchive");

const parseArgs = (args) => {
  const options = { limit: 100 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") options.limit = Number(args[++i]);
    else if (args[i] === "--uid") options.uid = args[++i];
    else throw new Error("Usage: node scripts/auditReplayArchives.js [--uid GAME_UID] [--limit 1..1000]");
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new Error("--limit must be an integer between 1 and 1000 per collection");
  }
  if (Object.hasOwn(options, "uid") && (!options.uid || options.uid.startsWith("--") || options.uid.length > 200)) {
    throw new Error("--uid requires a game UID up to 200 characters");
  }
  return options;
};

async function main(args = process.argv.slice(2)) {
  const { uid, limit } = parseArgs(args);
  if (!process.env.MONGO_URL) throw new Error("MONGO_URL must identify the database to audit");
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    // Sample existing indexes/natural order; do not sort a large archive or scan all chat arrays.
    const [transcripts, summaries] = await Promise.all([
      Game.find(uid ? { uid } : {})
        .select("uid archiveVersion summaryExpected")
        .limit(limit)
        .maxTimeMS(5000)
        .lean(),
      GameSummary.find(uid ? { _id: uid } : {})
        .select("_id")
        .limit(limit)
        .maxTimeMS(5000)
        .lean(),
    ]);
    const ids = new Set([...transcripts.map((record) => record.uid), ...summaries.map((record) => record._id)]);
    if (uid) ids.add(uid);
    let findings = 0;
    for (const id of ids) {
      // Load only one complete summary at a time. Large chat/moderation evidence is never fetched.
      const [transcript, summary] = await Promise.all([
        Game.findOne({ uid: id }).select("uid archiveVersion summaryExpected").maxTimeMS(5000).lean(),
        GameSummary.findById(id).maxTimeMS(5000).lean(),
      ]);
      const result = auditArchive(id, transcript, summary);
      if (transcripts.filter((record) => record.uid === id).length > 1)
        result.issues.push("duplicate-transcripts-in-sample");
      if (result.issues.length) {
        findings++;
        console.log(JSON.stringify(result));
      }
    }
    console.log(JSON.stringify({ inspected: ids.size, findings, readOnly: true, limitPerCollection: limit }));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    // Do not echo a connection URI, credentials, or document values from database errors.
    console.error(`Replay audit failed (${error.name || "Error"}). Check arguments and database access.`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, main };
