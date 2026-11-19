const Game = require("../../../models/game");
const GameSummary = require("../../../models/game-summary");

const ARCHIVE_VERSION = 1;
const retryableCodes = new Set([6, 7, 89, 91, 189, 262, 9001, 11000, 11600, 11602, 10107, 13435, 13436]);
const canRetry = (error) =>
  error &&
  (retryableCodes.has(error.code) ||
    ["VersionError", "MongoNetworkError", "MongoTimeoutError", "MongoServerSelectionError"].includes(error.name) ||
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(error.code));

const expectsSummary = (game) =>
  Boolean(
    game?.general?.uid &&
      game.general.uid !== "devgame" &&
      !game.general.private &&
      (game.gameState?.isTracksFlipped ||
        game.gameState?.isCompleted ||
        typeof game?.private?.summary?.publish === "function")
  );

// There is at most one running write and one coalesced pending request per game. In particular,
// a disconnected database must not build an ever-growing chain of game snapshots or callbacks.
const createArchiveWriter = ({
  GameModel = Game,
  SummaryModel = GameSummary,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn = (...args) => console.error(...args),
} = {}) => {
  const writers = new Map();

  const retry = async (write) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await write(attempt);
      } catch (error) {
        if (attempt >= 2 || !canRetry(error)) throw error;
        await wait(attempt === 0 ? 100 : 500);
      }
    }
  };

  const writeSummary = async (game) => {
    if (game.summarySaved || !expectsSummary(game)) return;
    if (typeof game.private?.summary?.publish !== "function") {
      throw Object.assign(new Error("Required replay summary is unavailable"), { name: "ReplaySummaryUnavailable" });
    }
    let summary = game.private.summary.publish();
    const payload = typeof summary?.toObject === "function" && summary.toObject();
    if (!payload || payload._id !== game.general.uid || typeof summary.save !== "function") {
      throw Object.assign(new Error("Required replay summary is unavailable"), { name: "ReplaySummaryUnavailable" });
    }
    await retry(async (attempt) => {
      // A prior write can have succeeded even if its acknowledgement was lost. Reloading also
      // handles an older process's existing summary and Mongoose's optimistic version check.
      if (attempt) {
        const stored = await SummaryModel.findById(payload._id);
        if (stored) {
          summary = stored;
          for (const key of Object.keys(payload)) {
            if (key !== "_id" && key !== "__v") summary[key] = payload[key];
          }
        }
      }
      await summary.save();
    });
    game.summarySaved = true;
  };

  const writeTranscript = async (job) => {
    // Capture only when this job reaches the head of the queue, so a delayed completion cannot
    // overwrite a later remake/leave snapshot with older chats. Keep the new document's _id
    // across retries if Mongo accepted an insert but the response was lost.
    const payload = job.transcript(job.game);
    let document;
    await retry(async () => {
      const stored = await GameModel.findOne({ uid: job.uid });
      document = stored || document || new GameModel(payload);
      if (stored && job.mergeStored) {
        job.mergeStored(document, payload);
      } else {
        for (const key of Object.keys(payload)) document[key] = payload[key];
      }
      await document.save();
    });
  };

  const run = async (job) => {
    // Try both records even if one fails. The live game is retained until BOTH required writes
    // succeed, and a later collector pass can repair the missing half without repeating ratings.
    const writes = [() => writeSummary(job.game)];
    if (job.transcript) writes.push(() => writeTranscript(job));
    const results = await Promise.all(
      writes.map(async (write) => {
        try {
          await write();
          return true;
        } catch (error) {
          // Never log chat contents, hands, or validation error values containing private evidence.
          warn(
            `Replay archive write failed for ${job.uid}; retained for retry (${error.name || "Error"}, ${error.code || "no code"}).`
          );
          return false;
        }
      })
    );
    return results.every(Boolean);
  };

  const drain = async (state, job) => {
    while (job) {
      job.resolve(await run(job));
      job = state.pending;
      state.pending = null;
    }
    writers.delete(state.uid);
  };

  const enqueue = (game, transcript, mergeStored) => {
    const uid = game?.general?.uid;
    if (!uid) return Promise.resolve(false);
    const state = writers.get(uid);
    if (state?.pending) {
      state.pending.game = game;
      if (transcript) {
        state.pending.transcript = transcript;
        state.pending.mergeStored = mergeStored;
      }
      return state.pending.promise;
    }
    const job = { uid, game, transcript, mergeStored };
    job.promise = new Promise((resolve) => {
      job.resolve = resolve;
    });
    if (state) {
      state.pending = job;
    } else {
      const next = { uid, pending: null };
      writers.set(uid, next);
      void drain(next, job);
    }
    return job.promise;
  };

  return {
    saveReplaySummary: (game) => enqueue(game),
    saveReplayArchive: (game, transcript, mergeStored) => enqueue(game, transcript, mergeStored),
  };
};

module.exports = { ARCHIVE_VERSION, expectsSummary, createArchiveWriter, ...createArchiveWriter() };
