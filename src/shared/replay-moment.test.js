import { List } from "immutable";
import buildEnhancedGameSummary from "../../models/game-summary/buildEnhancedGameSummary";
import buildReplay from "../frontend-scripts/replay/buildReplay";
import fixture from "../../__test__/mocks/mockGameSummary";
import { parseReplayLocation, parseReplayMoment, resolveReplayMoment, replayMomentPath } from "./replay-moment";

describe("exact replay moments", () => {
  it("round trips every real snapshot, including the final result sharing its phase", () => {
    const ticks = buildReplay(buildEnhancedGameSummary(fixture));
    ticks.forEach((snapshot, position) => {
      const path = replayMomentPath("a-normal_replay-123", snapshot);
      const { uid, moment } = parseReplayLocation(path.slice("/replay/".length));
      expect(uid).toBe("a-normal_replay-123");
      expect(resolveReplayMoment(ticks, moment)).toBe(position);
    });
    expect(ticks.last().phase).toBe(ticks.get(ticks.size - 2).phase);
    expect(replayMomentPath("game", ticks.last())).toMatch(/&end=1$/);
    expect(replayMomentPath("game", ticks.get(ticks.size - 2))).not.toContain("end=");
  });

  it("accepts existing plain replay links and both server and browser query inputs", () => {
    expect(parseReplayLocation("old-replay")).toEqual({ uid: "old-replay", moment: null });
    expect(resolveReplayMoment(List(), null)).toBe(0);
    const expected = { turn: 3, phase: "investigation", end: false };
    expect(parseReplayMoment("turn=3&phase=investigation")).toEqual(expected);
    expect(parseReplayMoment(new URLSearchParams("turn=3&phase=investigation"))).toEqual(expected);
    expect(parseReplayMoment({ turn: "3", phase: "investigation" })).toEqual(expected);
  });

  it.each([
    "game?turn=0&phase=election",
    "game?turn=-1&phase=election",
    "game?turn=1000000&phase=election",
    "game?turn=1.2&phase=election",
    "game?turn=1&phase=unrecognized",
    "game?turn=1",
    "game?phase=election",
    "game?turn=1&phase=election&end=0",
    "game?turn=1&phase=election&turn=2",
    "game?turn=1&phase=election&phase=candidacy",
    "game?turn=1&phase=election&end=1&end=1",
    "../game",
    "game%2Fother",
    "%",
    "x".repeat(201),
  ])("rejects malformed or ambiguous locations: %s", (location) => {
    expect(() => parseReplayLocation(location)).toThrow();
  });

  it("reports an unavailable moment instead of silently opening a different board", () => {
    const ticks = [{ turnNum: 0, phase: "candidacy", gameOver: false }];
    expect(() => resolveReplayMoment(ticks, { turn: 2, phase: "candidacy", end: false })).toThrow("does not contain");
    expect(() => resolveReplayMoment(ticks, { turn: 1, phase: "candidacy", end: true })).toThrow("does not contain");
  });
});
