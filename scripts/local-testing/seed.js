const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");
const mongoose = require("mongoose");
const { getLocalTestingConfig } = require("./config");

const OWNER = "shio-local-testing-fixtures-v1";
const MANIFEST_ID = "local-demo-v1";
const LOCK_ID = "local-demo-command-lock";
const MANIFEST_COLLECTION = "local_testing_fixtures";
const PASSWORD = "LocalTest123!";
const LOCK_MS = 5 * 60 * 1000;
const projectRoot = path.resolve(__dirname, "../..");

const snapshotHash = (snapshot) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        payload: snapshot.payload,
        updatedAt: snapshot.updatedAt,
        dailyUpdatedAt: snapshot.dailyUpdatedAt,
      })
    )
    .digest("hex");

const parseArgs = (args) => {
  const options = { mode: "seed", modActions: 1500 };
  let selectedMode = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--clean" || arg === "--reset") {
      if (selectedMode) throw new Error("Choose only one of --clean and --reset.");
      selectedMode = true;
      options.mode = arg.slice(2);
    } else if (arg === "--mod-actions" || arg.startsWith("--mod-actions=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++i];
      if (!/^\d+$/.test(value || "") || Number(value) > 10000) {
        throw new Error("--mod-actions must be an integer from 0 to 10000.");
      }
      options.modActions = Number(value);
    } else throw new Error(`Unknown option: ${arg}. Use --help for the available commands.`);
  }
  return options;
};

const acquireLock = async (collection, now = new Date()) => {
  const lock = { _id: LOCK_ID, owner: randomUUID(), expiresAt: new Date(now.getTime() + LOCK_MS) };
  try {
    await collection.insertOne(lock);
  } catch (error) {
    if (error.code !== 11000) throw error;
    const previous = await collection.findOne({ _id: LOCK_ID });
    if (!previous || !(previous.expiresAt instanceof Date) || previous.expiresAt > now) {
      throw new Error(
        "Another local fixture command is running. An interrupted command's lock expires after 5 minutes."
      );
    }
    const removed = await collection.deleteOne({ _id: LOCK_ID, owner: previous.owner, expiresAt: previous.expiresAt });
    if (removed.deletedCount !== 1)
      throw new Error("Another local fixture command acquired the lock. Try again shortly.");
    await collection.insertOne(lock);
  }
  return () => collection.deleteOne({ _id: LOCK_ID, owner: lock.owner });
};

const assertEmptyDatabase = async (db) => {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (name === MANIFEST_COLLECTION || name.startsWith("system.")) continue;
    if (await db.collection(name).findOne({}, { projection: { _id: 1 } })) {
      throw new Error(
        `This database already contains ${name} data and has no fixture ownership marker. Choose a fresh LOCAL_TEST_MONGO_URL such as mongodb://127.0.0.1:27017/shio-local-testing-demo.`
      );
    }
  }
};

const assertOwnedManifest = (manifest) => {
  if (manifest && (manifest.owner !== OWNER || manifest.version !== 1)) {
    throw new Error("The existing fixture marker belongs to a different tool/version. No data was changed.");
  }
};

const getModels = () => ({
  accounts: require("../../models/account"),
  profiles: require("../../models/profile"),
  games: require("../../models/game"),
  summaries: require("../../models/game-summary"),
  modActions: require("../../models/modAction"),
  reports: require("../../models/playerReport"),
});

const planRecords = (fixtures, models) => {
  const documents = {};
  const records = {};
  for (const [key, model] of Object.entries(models)) {
    documents[key] = (fixtures[key] || []).map((entry) => new model(entry));
    records[key] = {
      collection: model.collection.name,
      ids: documents[key].map((doc) => doc._id),
    };
  }
  return { documents, records };
};

const assertNoCollisions = async (db, plan) => {
  for (const [key, { collection, ids }] of Object.entries(plan.records)) {
    if (!ids.length) continue;
    const choices = [{ _id: { $in: ids } }];
    if (key === "accounts") choices.push({ username: { $in: plan.documents.accounts.map((a) => a.username) } });
    if (key === "games") choices.push({ uid: { $in: plan.documents.games.map((g) => g.uid) } });
    if (await db.collection(collection).findOne({ $or: choices }, { projection: { _id: 1 } })) {
      throw new Error(
        `A non-owned ${key} record conflicts with the demo identities. No conflicting record was replaced.`
      );
    }
  }
};

const cleanOwnedRecords = async (db, manifests, manifest, log) => {
  if (!manifest || manifest.status === "cleaned") return { removed: {}, preserved: [] };
  assertOwnedManifest(manifest);
  const removed = {};
  const preserved = [];
  const accounts = manifest.records.accounts;
  const hasOtherAccounts = Boolean(
    await db.collection(accounts.collection).findOne({ _id: { $nin: accounts.ids } }, { projection: { _id: 1 } })
  );
  for (const [key, { collection, ids }] of Object.entries(manifest.records)) {
    if (!ids.length) continue;
    const filter = { _id: { $in: ids } };
    if (key === "accounts") filter.username = { $in: manifest.usernames };
    removed[key] = (await db.collection(collection).deleteMany(filter)).deletedCount;
  }
  // Sessions for the demo accounts live in this same dedicated database. Other
  // sessions and newly created playtest records are left alone.
  const escapedNames = manifest.usernames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  removed.sessions = (
    await db.collection("sessions").deleteMany({
      $or: [
        { "session.passport.user": { $in: manifest.usernames } },
        { session: { $regex: `"(?:${escapedNames.join("|")})"` } },
      ],
    })
  ).deletedCount;
  const board = manifest.leaderboard;
  if (board) {
    const current = await db.collection(board.collection).findOne({ _id: board.id });
    if (current && !hasOtherAccounts && board.hash && snapshotHash(current) === board.hash) {
      removed.leaderboard = (
        await db.collection(board.collection).deleteOne({ _id: board.id, updatedAt: current.updatedAt })
      ).deletedCount;
    } else if (current)
      preserved.push("The shared leaderboard was changed or other accounts exist; it was left intact.");
  }
  await manifests.updateOne({ _id: MANIFEST_ID, owner: OWNER }, { $set: { status: "cleaned", cleanedAt: new Date() } });
  for (const note of preserved) log(note);
  return { removed, preserved };
};

const reportFor = (manifest, mongoUrl, reused = false) => ({
  database: mongoUrl,
  reused,
  createdAt: manifest.createdAt,
  counts: Object.fromEntries(Object.entries(manifest.records).map(([key, value]) => [key, value.ids.length])),
  password: PASSWORD,
  accounts: manifest.loginAccounts,
  scenarios: manifest.scenarios,
  note: "Synthetic local data. Stored IPs are history fields; live localhost connections still originate from localhost.",
});

const writeReport = (databaseName, report) => {
  const directory = path.join(projectRoot, ".local-testing");
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `${databaseName}-fixtures.json`);
  fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return filename;
};

const seedDatabase = async ({ mode = "seed", modActions = 1500, env = process.env, log = console.log } = {}) => {
  const config = getLocalTestingConfig(env);
  // Validate the command before importing models or connecting to any database.
  if (!["seed", "reset", "clean"].includes(mode)) throw new Error("Unknown local fixture operation.");
  if (!Number.isInteger(modActions) || modActions < 0 || modActions > 10000)
    throw new Error("Invalid moderation action count.");
  const models = getModels();
  mongoose.set("useCreateIndex", true);
  mongoose.set("useFindAndModify", false);
  let release;
  try {
    await mongoose.connect(config.mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
    });
    const db = mongoose.connection.db;
    const manifests = db.collection(MANIFEST_COLLECTION);
    release = await acquireLock(manifests);
    let existing = await manifests.findOne({ _id: MANIFEST_ID });
    assertOwnedManifest(existing);
    if (mode === "clean") {
      const result = await cleanOwnedRecords(db, manifests, existing, log);
      log("Removed only manifest-owned fixture records:", result.removed);
      return result;
    }
    if (existing?.status === "complete" && mode === "seed") {
      const report = reportFor(existing, config.mongoUrl, true);
      log("Demo data already exists; no accounts, passwords or histories were reset. Use --reset to restore it.");
      log(`Fixture reference: ${writeReport(mongoose.connection.name, report)}`);
      return report;
    }
    if (existing && existing.status !== "cleaned") {
      if (mode !== "reset")
        throw new Error("A previous seed was interrupted. Run pnpm local:seed --reset or pnpm local:clean.");
      await cleanOwnedRecords(db, manifests, existing, log);
      existing = await manifests.findOne({ _id: MANIFEST_ID });
    }
    if (!existing) await assertEmptyDatabase(db);
    const { buildFixtures } = require("./fixtures");
    const fixtures = buildFixtures({ modActions });
    const plan = planRecords(fixtures, models);
    await assertNoCollisions(db, plan);
    const Leaderboard = require("../../models/leaderboard");
    const manifest = {
      _id: MANIFEST_ID,
      owner: OWNER,
      version: 1,
      createdAt: new Date(),
      status: "seeding",
      records: plan.records,
      usernames: plan.documents.accounts.map((a) => a.username),
      loginAccounts: fixtures.accounts.map((a) => ({ username: a.username, role: a.staffRole || "player" })),
      scenarios: fixtures.scenarios,
      leaderboard: { collection: Leaderboard.collection.name, id: "current" },
    };
    // Save exact identities first, so even a failed/partial seed can be cleaned
    // without deleting records by a broad prefix or dropping the database.
    await manifests.replaceOne({ _id: MANIFEST_ID }, manifest, { upsert: true });
    try {
      await models.accounts.init();
      for (const account of plan.documents.accounts) {
        await new Promise((resolve, reject) =>
          models.accounts.register(account, PASSWORD, (error) => (error ? reject(error) : resolve()))
        );
      }
      for (const key of ["profiles", "games", "summaries", "modActions", "reports"]) {
        for (let offset = 0; offset < plan.documents[key].length; offset += 500) {
          await models[key].insertMany(plan.documents[key].slice(offset, offset + 500));
        }
      }
      // Production's large archive provisions this index separately. Here it
      // is created only within the validated, dedicated local fixture database.
      await models.games.collection.createIndex({ uid: 1 });
      const otherAccount = await models.accounts
        .findOne({ _id: { $nin: plan.records.accounts.ids } })
        .select("_id")
        .lean();
      const existingBoard = await Leaderboard.findById("current").select("_id").lean();
      if (!otherAccount && !existingBoard) {
        await require("../retrieveLeaderboardData").refreshLeaderboards({ log });
        const snapshot = await Leaderboard.findById("current").lean();
        manifest.leaderboard.hash = snapshotHash(snapshot);
        await manifests.updateOne({ _id: MANIFEST_ID, owner: OWNER }, { $set: { leaderboard: manifest.leaderboard } });
      } else {
        // Global refresh rolls per-account baselines. A local tester may have
        // added accounts since the first seed; never rewrite those accounts.
        delete manifest.leaderboard;
        log(
          "Other test accounts or an existing leaderboard are present; their snapshot and daily baselines were left unchanged."
        );
      }
      manifest.status = "complete";
      await manifests.replaceOne({ _id: MANIFEST_ID, owner: OWNER }, manifest);
      const report = reportFor(manifest, config.mongoUrl);
      log("Created local demo data:", report.counts);
      log(`Log in as LocalDemoAdmin (admin) or LocalDemoPlayer01. Password for all demo accounts: ${PASSWORD}`);
      log(`Fixture reference: ${writeReport(mongoose.connection.name, report)}`);
      log("Stop/start the app after seeding, reset or cleanup so cached staff and presence state refreshes.");
      return report;
    } catch (error) {
      await manifests.updateOne({ _id: MANIFEST_ID, owner: OWNER }, { $set: { status: "failed" } });
      throw error;
    }
  } finally {
    try {
      if (release) await release();
    } finally {
      await mongoose.disconnect();
    }
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "pnpm local:seed [--reset] [--mod-actions 1500]\npnpm local:clean\n\nDefaults to the dedicated shio-local-testing database. Uses only LOCAL_TEST_MONGO_URL overrides. Never drops a database."
    );
    return;
  }
  await seedDatabase(options);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Local fixture setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { seedDatabase, parseArgs, snapshotHash, acquireLock, OWNER, MANIFEST_ID, MANIFEST_COLLECTION };
