const { createArchiveWriter, expectsSummary } = require("../../routes/socket/game/replay-archive");
const auditArchive = require("../../models/game-summary/auditArchive");
const { parseArgs } = require("../../scripts/auditReplayArchives");

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const networkError = () => Object.assign(new Error("connection lost"), { name: "MongoNetworkError" });

const harness = () => {
  const records = new Map();
  let nextId = 0;
  class Transcript {
    constructor(payload) {
      Object.assign(this, payload);
      this._id = payload._id || ++nextId;
    }
    async save() {
      records.set(this.uid, { ...this });
      return this;
    }
    static async findOne({ uid }) {
      return records.has(uid) ? new Transcript(records.get(uid)) : null;
    }
  }
  const summary = {
    toObject: () => ({ _id: "archive-test", archiveVersion: 1, logs: [] }),
    save: jest.fn().mockResolvedValue(),
  };
  const game = {
    general: { uid: "archive-test" },
    private: { summary: { publish: () => summary } },
    chats: ["initial"],
  };
  const wait = jest.fn().mockResolvedValue();
  const warn = jest.fn();
  const SummaryModel = { findById: jest.fn().mockResolvedValue(null) };
  const writer = createArchiveWriter({ GameModel: Transcript, SummaryModel, wait, warn });
  const snapshot = (source) => ({ uid: source.general.uid, chats: [...source.chats] });
  return { game, summary, records, Transcript, SummaryModel, wait, warn, writer, snapshot };
};

it("retries a transient summary failure and marks success only after acknowledgement", async () => {
  const h = harness();
  const pause = deferred();
  h.summary.save.mockRejectedValueOnce(networkError());
  h.wait.mockReturnValueOnce(pause.promise);
  const saved = h.writer.saveReplayArchive(h.game, h.snapshot);
  await tick();
  expect(h.game.summarySaved).toBeUndefined();
  expect(h.records.size).toBe(1); // The transcript can persist while the independent summary retries.
  pause.resolve();
  expect(await saved).toBe(true);
  expect(h.summary.save).toHaveBeenCalledTimes(2);
  expect(h.game.summarySaved).toBe(true);
  expect(h.records.size).toBe(1);
  expect(h.warn).not.toHaveBeenCalled();
});

it("retains the summary flag and saves the transcript when a permanent summary error occurs", async () => {
  const h = harness();
  h.summary.save.mockRejectedValueOnce(Object.assign(new Error("bad legacy field"), { name: "ValidationError" }));
  expect(await h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(false);
  expect(h.game.summarySaved).toBeUndefined();
  expect(h.summary.save).toHaveBeenCalledTimes(1);
  expect(h.records.size).toBe(1);
  expect(h.warn).toHaveBeenCalledTimes(1);
  // A subsequent collector pass can complete the pair from retained live data.
  expect(await h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(true);
  expect(h.game.summarySaved).toBe(true);
});

it("bounds transient transcript retries and permits a later collector retry", async () => {
  const h = harness();
  const save = jest.spyOn(h.Transcript.prototype, "save").mockRejectedValue(networkError());
  expect(await h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(false);
  expect(save).toHaveBeenCalledTimes(3);
  expect(h.wait).toHaveBeenCalledTimes(2);
  expect(h.warn).toHaveBeenCalledTimes(1);
  expect(h.game.summarySaved).toBe(true);
  save.mockRestore();
  expect(await h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(true);
  expect(h.summary.save).toHaveBeenCalledTimes(1);
});

it("serializes concurrent completion/teardown writes and coalesces pending requests to the newest chats", async () => {
  const h = harness();
  const pause = deferred();
  const original = h.Transcript.prototype.save;
  const save = jest.spyOn(h.Transcript.prototype, "save").mockImplementationOnce(async function () {
    await pause.promise;
    return original.call(this);
  });
  const first = h.writer.saveReplayArchive(h.game, h.snapshot);
  await tick();
  h.game.chats.push("remake");
  const next = h.writer.saveReplayArchive(h.game, h.snapshot);
  h.game.chats.push("last leave");
  expect(h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(next);
  expect(h.writer.saveReplaySummary(h.game)).toBe(next);
  expect(save).toHaveBeenCalledTimes(1);
  pause.resolve();
  expect(await first).toBe(true);
  expect(await next).toBe(true);
  expect(save).toHaveBeenCalledTimes(2);
  expect(h.records.size).toBe(1);
  expect(h.records.get("archive-test").chats).toEqual(["initial", "remake", "last leave"]);
  expect(h.summary.save).toHaveBeenCalledTimes(1);
  save.mockRestore();
});

it.each(["VersionError", "MongoNetworkError"])("recovers %s without inserting another transcript", async (name) => {
  const h = harness();
  const original = h.Transcript.prototype.save;
  const ids = [];
  const save = jest.spyOn(h.Transcript.prototype, "save").mockImplementationOnce(async function () {
    ids.push(this._id);
    await original.call(this); // Mongo accepted the write, but the reply was lost/conflicted.
    throw Object.assign(new Error("retry"), { name });
  });
  expect(await h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(true);
  expect(save).toHaveBeenCalledTimes(2);
  expect(h.records.size).toBe(1);
  expect(h.records.get("archive-test")._id).toBe(ids[0]);
  save.mockRestore();
});

it("recovers an existing summary after a duplicate-key response", async () => {
  const h = harness();
  const stored = { _id: "archive-test", save: jest.fn().mockResolvedValue() };
  h.summary.save.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: 11000 }));
  h.SummaryModel.findById.mockResolvedValueOnce(stored);
  expect(await h.writer.saveReplaySummary(h.game)).toBe(true);
  expect(stored.save).toHaveBeenCalledTimes(1);
  expect(stored.archiveVersion).toBe(1);
  expect(h.game.summarySaved).toBe(true);
});

it("audits incomplete pairs and parser failures without altering or dropping original records", () => {
  const transcript = { uid: "test", summaryExpected: true, archiveVersion: 1 };
  const malformed = { _id: "test", players: [], logs: [{}], customGameSettings: { enabled: true } };
  const original = JSON.stringify(malformed);
  expect(auditArchive("test", transcript, null).issues).toEqual(["missing-summary"]);
  expect(auditArchive("test", null, malformed).issues).toEqual([
    "missing-transcript",
    "summary-reconstruction-warning",
  ]);
  expect(JSON.stringify(malformed)).toBe(original);
  expect(auditArchive("test", { ...transcript, summaryExpected: false }, null).issues).toEqual([]);
  expect(auditArchive("test", { uid: "test" }, null).issues).toEqual(["legacy-summary-unavailable-or-intentional"]);
  expect(auditArchive("test", transcript, { _id: "test", players: [], logs: [] }).issues).toEqual([]);
});

it("requires explicitly bounded audit arguments and has no write/repair option", () => {
  expect(parseArgs([])).toEqual({ limit: 100 });
  expect(parseArgs(["--uid", "test", "--limit", "1"])).toEqual({ uid: "test", limit: 1 });
  expect(() => parseArgs(["--limit", "1001"])).toThrow();
  expect(() => parseArgs(["--uid"])).toThrow();
  expect(() => parseArgs(["--repair"])).toThrow();
});

it("does not report a missing required summary as a successful archive", async () => {
  const h = harness();
  h.game.private.summary.publish = () => ({ toObject: () => null });
  expect(expectsSummary(h.game)).toBe(true);
  expect(await h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(false);
  expect(h.game.summarySaved).toBeUndefined();
  expect(h.records.size).toBe(1);
  expect(h.warn).toHaveBeenCalledWith(expect.stringContaining("ReplaySummaryUnavailable"));
});

it.each([
  false,
  "liberal",
])("preserves a started public game's summary regardless of completion (%s)", async (isCompleted) => {
  const h = harness();
  h.game.gameState = { isTracksFlipped: true, isCompleted };
  expect(await h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(true);
  expect(h.summary.save).toHaveBeenCalledTimes(1);
  expect(h.game.summarySaved).toBe(true);
});

it.each(["private", "devgame", "waiting"])("keeps intentional %s archives transcript-only", async (kind) => {
  const h = harness();
  if (kind === "private") h.game.general.private = true;
  if (kind === "devgame") h.game.general.uid = "devgame";
  if (kind === "waiting") delete h.game.private.summary;
  expect(expectsSummary(h.game)).toBe(false);
  expect(await h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(true);
  expect(h.summary.save).not.toHaveBeenCalled();
  expect(h.records.size).toBe(1);
});

it("keeps legacy records versionless on read and stamps new published summaries", () => {
  const Game = require("../../models/game");
  const GameSummary = require("../../models/game-summary");
  const GameSummaryBuilder = require("../../models/game-summary/GameSummaryBuilder");
  const legacy = { _id: "legacy", players: [], logs: [] };
  expect(GameSummary.hydrate(legacy).toObject()).not.toHaveProperty("archiveVersion");
  expect(Game.hydrate({ uid: "legacy" }).toObject()).not.toHaveProperty("archiveVersion");
  const published = new GameSummaryBuilder("new", new Date(), {}, {}, [], {}, {}).publish();
  expect(published.toObject().archiveVersion).toBe(1);
});

it("identifies an unexpectedly missing builder on a started public table", async () => {
  const h = harness();
  h.game.gameState = { isStarted: true };
  delete h.game.private.summary;
  expect(expectsSummary(h.game)).toBe(true);
  expect(await h.writer.saveReplayArchive(h.game, h.snapshot)).toBe(false);
  expect(h.records.size).toBe(1);
  expect(h.warn).toHaveBeenCalledWith(expect.stringContaining("ReplaySummaryUnavailable"));
});
