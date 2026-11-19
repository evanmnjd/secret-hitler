import mongoose from "mongoose";
import GameSummary from "../../models/game-summary";
import GameSummaryBuilder from "../../models/game-summary/GameSummaryBuilder";
import buildEnhancedGameSummary from "../../models/game-summary/buildEnhancedGameSummary";
import buildReplay from "../../src/frontend-scripts/replay/buildReplay";
import { List } from "immutable";
import { currentSummary, legacyModel, measure } from "../../scripts/replayStorageBenchmark";
import generic from "../mocks/mockGameSummary";
import veto from "../mocks/veto";
import veto2 from "../mocks/veto2";

const stripNestedIds = (value) => {
  if (Array.isArray(value)) return value.map(stripNestedIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "_id")
      .map(([key, item]) => [key, stripNestedIds(item)])
  );
};

it("does not allocate nested IDs or absent action arrays when publishing a new replay", () => {
  const source = currentSummary(generic);
  const summary = new GameSummaryBuilder(
    source._id,
    source.date,
    source.gameSetting,
    {},
    source.players,
    {},
    {},
    List(source.logs)
  ).publish();
  expect(summary.validateSync()).toBeUndefined();
  const document = summary.toObject();
  expect(document._id).toBe(source._id);
  expect(document.players.every((player) => !Object.hasOwn(player, "_id"))).toBe(true);
  expect(document.logs.every((log) => !Object.hasOwn(log, "_id"))).toBe(true);
  expect(document.logs[4]).not.toHaveProperty("presidentHand");
  expect(document.logs[4]).not.toHaveProperty("policyPeek");
  expect(document.logs[0].presidentHand).toEqual(source.logs[0].presidentHand);
  expect(document.logs[0].votes).toEqual(source.logs[0].votes);
});

it.each([
  generic,
  veto,
  veto2,
])("reconstructs all phases of %p identically from compact and legacy BSON-shaped documents", (fixture) => {
  const source = currentSummary(fixture);
  const compact = new GameSummary(source).toObject();
  const legacy = new (legacyModel())(source).toObject();
  const hydratedLegacy = GameSummary.hydrate(legacy).toObject();
  expect(hydratedLegacy.players[0]._id).toEqual(legacy.players[0]._id);
  expect(hydratedLegacy.logs[0]._id).toEqual(legacy.logs[0]._id);
  const snapshots = (document) => stripNestedIds(buildReplay(buildEnhancedGameSummary(document)).toJS());
  expect(snapshots(compact)).toEqual(snapshots(hydratedLegacy));
  expect(buildEnhancedGameSummary(compact).winningTeam).toEqual(buildEnhancedGameSummary(hydratedLegacy).winningTeam);
});

it("keeps root version/identity and legacy settings IDs without creating new settings IDs", () => {
  const id = new mongoose.Types.ObjectId();
  const legacy = { ...currentSummary(generic), __v: 7, gameSetting: { avalonSH: { _id: id, withPercival: true } } };
  const hydrated = GameSummary.hydrate(legacy).toObject();
  expect(hydrated._id).toBe(generic._id);
  expect(hydrated.__v).toBe(7);
  expect(hydrated.gameSetting.avalonSH._id).toEqual(id);
  expect(hydrated.gameSetting.avalonSH.withPercival).toBe(true);
  const fresh = new GameSummary(legacy).toObject();
  expect(fresh.gameSetting.avalonSH).toEqual({ withPercival: true });
});

it("retains explicitly supplied empty action arrays and all unknown historical row metadata on hydration", () => {
  const source = currentSummary(generic);
  source.logs[0].policyPeek = [];
  source.logs[0].historicalEvidence = "retain raw metadata";
  const legacy = GameSummary.hydrate(source).toObject();
  expect(legacy.logs[0].historicalEvidence).toBe("retain raw metadata");
  expect(legacy.logs[0].policyPeek).toEqual([]);
});

it("measures positive BSON savings for a real fixture without changing its large chat archive", () => {
  const result = measure("generic", generic);
  expect(result.bytesSaved).toBeGreaterThan(0);
  expect(result.beforeSummaryBytes - result.afterSummaryBytes).toBe(result.bytesSaved);
  expect(result.combinedPercentSaved).toBeLessThan(result.summaryPercentSaved);
});
