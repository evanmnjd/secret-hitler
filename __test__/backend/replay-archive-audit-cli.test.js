const mongoose = require("mongoose");
const Game = require("../../models/game");
const GameSummary = require("../../models/game-summary");
const { main, parseArgs } = require("../../scripts/auditReplayArchives");
const legacySummary = require("../mocks/mockGameSummary");

const query = (value) => ({
  select: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  maxTimeMS: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
});

describe("read-only replay archive audit command", () => {
  let originalMongoUrl, output, writeMethods;

  beforeEach(() => {
    originalMongoUrl = process.env.MONGO_URL;
    process.env.MONGO_URL = "mongodb://127.0.0.1:27017/audit-test";
    output = [];
    jest.spyOn(mongoose, "connect").mockResolvedValue(mongoose);
    jest.spyOn(mongoose, "disconnect").mockResolvedValue();
    jest.spyOn(console, "log").mockImplementation((line) => output.push(JSON.parse(line)));
    writeMethods = [];
    for (const Model of [Game, GameSummary]) {
      for (const method of [
        "create",
        "insertMany",
        "updateOne",
        "updateMany",
        "deleteOne",
        "deleteMany",
        "bulkWrite",
      ]) {
        writeMethods.push(
          jest.spyOn(Model, method).mockImplementation(() => {
            throw new Error("Audit attempted a write");
          })
        );
      }
      writeMethods.push(
        jest.spyOn(Model.prototype, "save").mockImplementation(() => {
          throw new Error("Audit attempted a save");
        })
      );
    }
  });

  afterEach(() => {
    if (originalMongoUrl === undefined) delete process.env.MONGO_URL;
    else process.env.MONGO_URL = originalMongoUrl;
    jest.restoreAllMocks();
  });

  it("reports incomplete pairs and reconstruction warnings without fetching chats or writing archives", async () => {
    const valid = { ...legacySummary, _id: "valid-legacy" };
    const malformed = {
      _id: "malformed",
      players: [],
      logs: [{ privateHand: "DO_NOT_LOG_PRIVATE_HAND" }],
      customGameSettings: { enabled: true },
    };
    const transcripts = [
      { uid: "valid-legacy" },
      { uid: "missing-summary", summaryExpected: true, archiveVersion: 1 },
      { uid: "malformed", summaryExpected: true },
    ];
    const summaries = new Map([
      [valid._id, valid],
      [malformed._id, malformed],
      ["missing-transcript", { ...valid, _id: "missing-transcript" }],
    ]);
    const transcriptsBefore = JSON.stringify(transcripts);
    const summariesBefore = JSON.stringify([...summaries]);
    const transcriptSample = query(transcripts);
    const summarySample = query([...summaries.keys()].map((_id) => ({ _id })));
    jest.spyOn(Game, "find").mockReturnValue(transcriptSample);
    jest.spyOn(GameSummary, "find").mockReturnValue(summarySample);
    const transcriptQueries = [];
    jest.spyOn(Game, "findOne").mockImplementation(({ uid }) => {
      const next = query(transcripts.find((record) => record.uid === uid) || null);
      transcriptQueries.push(next);
      return next;
    });
    jest.spyOn(GameSummary, "findById").mockImplementation((id) => query(summaries.get(id) || null));

    await main(["--limit", "3"]);

    expect(mongoose.connect).toHaveBeenCalledWith(
      process.env.MONGO_URL,
      expect.objectContaining({
        autoIndex: false,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      })
    );
    expect(transcriptSample.limit).toHaveBeenCalledWith(3);
    expect(summarySample.limit).toHaveBeenCalledWith(3);
    expect(transcriptSample.select).toHaveBeenCalledWith("uid archiveVersion summaryExpected");
    expect(summarySample.select).toHaveBeenCalledWith("_id");
    expect(transcriptSample.maxTimeMS).toHaveBeenCalledWith(5000);
    expect(summarySample.maxTimeMS).toHaveBeenCalledWith(5000);
    for (const item of transcriptQueries) {
      expect(item.select).toHaveBeenCalledWith("uid archiveVersion summaryExpected");
      expect(item.maxTimeMS).toHaveBeenCalledWith(5000);
    }
    expect(output).toEqual([
      { uid: "missing-summary", issues: ["missing-summary"] },
      { uid: "malformed", issues: ["summary-reconstruction-warning"] },
      { uid: "missing-transcript", issues: ["missing-transcript"] },
      { inspected: 4, findings: 3, readOnly: true, limitPerCollection: 3 },
    ]);
    expect(JSON.stringify(output)).not.toContain("DO_NOT_LOG_PRIVATE_HAND");
    expect(JSON.stringify(transcripts)).toBe(transcriptsBefore);
    expect(JSON.stringify([...summaries])).toBe(summariesBefore);
    for (const method of writeMethods) expect(method).not.toHaveBeenCalled();
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  });

  it("inspects an explicitly requested missing UID even when neither collection contains it", async () => {
    jest.spyOn(Game, "find").mockReturnValue(query([]));
    jest.spyOn(GameSummary, "find").mockReturnValue(query([]));
    jest.spyOn(Game, "findOne").mockReturnValue(query(null));
    jest.spyOn(GameSummary, "findById").mockReturnValue(query(null));

    await main(["--uid", "missing", "--limit", "1"]);

    expect(Game.find).toHaveBeenCalledWith({ uid: "missing" });
    expect(GameSummary.find).toHaveBeenCalledWith({ _id: "missing" });
    expect(output[0]).toEqual({
      uid: "missing",
      issues: ["missing-transcript", "legacy-summary-unavailable-or-intentional"],
    });
    expect(output[1]).toEqual({ inspected: 1, findings: 1, readOnly: true, limitPerCollection: 1 });
    for (const method of writeMethods) expect(method).not.toHaveBeenCalled();
  });

  it("disconnects after a failed database read without logging raw errors or archive data", async () => {
    const failedQuery = query(null);
    failedQuery.lean.mockRejectedValue(new Error("DO_NOT_LOG_DATABASE_SECRET"));
    jest.spyOn(Game, "find").mockReturnValue(failedQuery);
    jest.spyOn(GameSummary, "find").mockReturnValue(query([]));

    await expect(main([])).rejects.toThrow("DO_NOT_LOG_DATABASE_SECRET");

    expect(output).toEqual([]);
    expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
    for (const method of writeMethods) expect(method).not.toHaveBeenCalled();
  });

  it.each([
    ["--limit", "0"],
    ["--limit", "1001"],
    ["--limit", "1.5"],
    ["--limit"],
    ["--uid"],
    ["--uid", "--limit"],
    ["--uid", "x".repeat(201)],
    ["--repair"],
  ])("rejects invalid or mutating arguments %j before connecting", async (...args) => {
    expect(() => parseArgs(args)).toThrow();
    await expect(main(args)).rejects.toThrow();
    expect(mongoose.connect).not.toHaveBeenCalled();
    for (const method of writeMethods) expect(method).not.toHaveBeenCalled();
  });
});
