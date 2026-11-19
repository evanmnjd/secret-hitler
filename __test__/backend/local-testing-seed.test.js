const { parseArgs, snapshotHash } = require("../../scripts/local-testing/seed");

describe("local fixture command arguments", () => {
  it("defaults to non-destructive seeding with three moderation pages", () => {
    expect(parseArgs([])).toEqual({ mode: "seed", modActions: 1500 });
  });

  it.each(["--clean", "--reset"])("selects the explicit %s operation", (mode) => {
    expect(parseArgs([mode]).mode).toBe(mode.slice(2));
  });

  it("accepts either moderation-count syntax and the builder's upper bound", () => {
    expect(parseArgs(["--mod-actions", "600"]).modActions).toBe(600);
    expect(parseArgs(["--mod-actions=10000"]).modActions).toBe(10000);
  });

  it.each([
    ["--clean", "--reset"],
    ["--reset", "--reset"],
    ["--mod-actions", "10001"],
    ["--mod-actions=-1"],
    ["--mod-actions", "1.5"],
    ["--mod-actions"],
    ["--drop-database"],
  ])("rejects an ambiguous or unsupported operation %j", (...args) => {
    expect(() => parseArgs(args)).toThrow();
  });
});

it("detects edits to every leaderboard field that cleanup protects", () => {
  const original = { payload: { board: ["Alice"] }, updatedAt: new Date(0), dailyUpdatedAt: new Date(0) };
  expect(snapshotHash({ ...original, _id: "current" })).toBe(snapshotHash(original));
  for (const changed of [
    { payload: { board: ["Bob"] } },
    { updatedAt: new Date(1) },
    { dailyUpdatedAt: new Date(1) },
  ]) {
    expect(snapshotHash({ ...original, ...changed })).not.toBe(snapshotHash(original));
  }
});
