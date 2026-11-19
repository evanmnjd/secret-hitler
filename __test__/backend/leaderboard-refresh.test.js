const Account = require("../../models/account");
const Leaderboard = require("../../models/leaderboard");
const { refreshLeaderboards } = require("../../scripts/retrieveLeaderboardData");
const { CURRENT_SEASON_FIELDS: fields } = require("../../src/shared/season");
const nowMs = Date.parse("2026-09-08T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

const player = (username, overrides = {}) => ({
  username,
  eloSeason: 1600,
  eloOverall: 2200,
  xpSeason: 0,
  [fields.wins]: 10,
  [fields.losses]: 10,
  lastRankedGameAt: new Date(nowMs),
  lastCompletedGame: new Date(nowMs),
  ...overrides,
});

// Mock only the query/storage boundaries. Apply the actual filters/projection requested by the
// cron, await each row, and retain account mutations so rerun/baseline behavior is observable.
const database = (accounts) => {
  const saved = [];
  let snapshot = null;
  for (const account of accounts) {
    account.save = jest.fn(async () => {
      await Promise.resolve();
      saved.push(account.username);
    });
  }
  const find = jest.spyOn(Account, "find").mockImplementation((filter, projection) => {
    const rows = accounts.filter((account) => {
      if (filter.lastCompletedGame) return account.lastCompletedGame >= filter.lastCompletedGame.$gte;
      if (filter.isBanned) return account.isBanned !== filter.isBanned.$ne;
      throw new Error("Unexpected account scan");
    });
    const query = {
      lean: jest.fn(() => query),
      cursor: () => ({
        eachAsync: async (visit) => {
          for (const row of rows) {
            const document = projection
              ? Object.fromEntries(
                  Object.keys(projection)
                    .filter((key) => key in row)
                    .map((key) => [key, row[key]])
                )
              : row;
            if (filter.lastCompletedGame && projection) {
              document.save = async () => {
                row.previousDayElo = document.previousDayElo;
                row.previousDayXP = document.previousDayXP;
                return row.save();
              };
            }
            await visit(document);
          }
        },
      }),
    };
    return query;
  });
  const read = jest.spyOn(Leaderboard, "findById").mockImplementation(() => ({
    select: () => ({ lean: () => Promise.resolve(snapshot) }),
  }));
  const storeSnapshot = (data) => (snapshot = data);
  const publish = jest.spyOn(Leaderboard, "findByIdAndUpdate").mockImplementation(async (_id, data) => {
    storeSnapshot(data);
    return {};
  });
  return { saved, find, publish, read, storeSnapshot, snapshot: () => snapshot };
};
const names = (board) => board.map((entry) => entry.userName);
const refresh = (log = jest.fn()) => refreshLeaderboards({ nowMs, log });
afterEach(() => jest.restoreAllMocks());

it("publishes exactly the qualified Season Elo set without a score floor or lifetime-games gate", async () => {
  const rows = [
    player("at-twenty", { games: [] }),
    player("below-start", { eloSeason: 1100 }),
    player("zero", { eloSeason: 0 }),
    player("negative", { eloSeason: -100 }),
    player("nineteen", { [fields.losses]: 9, games: Array(1000).fill("old") }),
    player("provisional", { [fields.wins]: 4, [fields.losses]: 5 }),
    player("inactive", { lastRankedGameAt: new Date(nowMs - 14 * day - 1) }),
    player("at-boundary", { lastRankedGameAt: new Date(nowMs - 14 * day) }),
    player("unranked", { lastRankedGameAt: undefined }),
    player("banned", { isBanned: true, eloSeason: 9999 }),
    player("bad-score", { eloSeason: NaN }),
  ];
  const { find, publish } = database(rows);
  const before = rows.map((row) => ({
    eloSeason: row.eloSeason,
    eloOverall: row.eloOverall,
    wins: row[fields.wins],
    losses: row[fields.losses],
    activity: row.lastRankedGameAt,
  }));
  const data = await refresh();
  expect(names(data.seasonalLeaderboardElo)).toEqual(["at-twenty", "at-boundary", "below-start", "zero", "negative"]);
  expect(find.mock.calls[1][1]).toMatchObject({ [fields.wins]: 1, [fields.losses]: 1, lastRankedGameAt: 1 });
  expect(publish).toHaveBeenCalledWith(
    "current",
    { payload: data, updatedAt: new Date(nowMs), dailyUpdatedAt: new Date(nowMs) },
    { upsert: true }
  );
  rows.forEach((row, i) => {
    expect({
      eloSeason: row.eloSeason,
      eloOverall: row.eloOverall,
      wins: row[fields.wins],
      losses: row[fields.losses],
      activity: row.lastRankedGameAt,
    }).toEqual(before[i]);
  });
});

it("restores the seasonal row on the next refresh after ranked play, but not after casual/practice XP", async () => {
  const row = player("returning", {
    lastCompletedGame: new Date(nowMs - 20 * day),
    lastRankedGameAt: new Date(nowMs - 20 * day),
  });
  database([row]);
  expect((await refresh()).seasonalLeaderboardElo).toEqual([]);
  row.lastCompletedGame = new Date(nowMs);
  row.xpSeason = 12;
  row.isRainbowOverall = true;
  const casual = await refresh();
  expect(casual.seasonalLeaderboardElo).toEqual([]);
  expect(casual.dailyLeaderboardXP).toEqual([]); // Daily gains remain the last 09:00 UTC snapshot.
  expect(names(casual.seasonalLeaderboardXP)).toEqual([row.username]);
  // A result can arrive after this refresh captured its clock but before the row is scanned.
  row.lastRankedGameAt = new Date(nowMs + 1);
  row[fields.wins]++;
  expect(names((await refresh()).seasonalLeaderboardElo)).toEqual([row.username]);
});

it("uses 1600/0 absent baselines, preserves zero/negative baselines and rolls only once per daily period", async () => {
  const rows = [
    player("launch"),
    player("first-win", { eloSeason: 1620, xpSeason: 2 }),
    player("zero-baseline", { eloSeason: 20, previousDayElo: 0 }),
    player("negative-baseline", { eloSeason: -80, previousDayElo: -100 }),
    player("bad-baseline", { eloSeason: 1620, previousDayElo: NaN, xpSeason: 1, previousDayXP: Infinity }),
    player("banned", { isBanned: true }),
    player("old-activity", { lastCompletedGame: new Date(nowMs - day - 1), previousDayElo: 1200 }),
  ];
  const { saved, find, publish, storeSnapshot } = database(rows);
  publish.mockImplementation(async (_id, snapshot) => {
    expect(saved).toHaveLength(6);
    storeSnapshot(snapshot);
  });
  const data = await refresh();
  expect(data.dailyLeaderboardElo.find((row) => row.userName === "launch").dailyEloDifference).toBe(0);
  for (const name of ["first-win", "zero-baseline", "negative-baseline", "bad-baseline"]) {
    expect(data.dailyLeaderboardElo.find((row) => row.userName === name).dailyEloDifference).toBe(20);
  }
  expect(data.dailyLeaderboardXP.find((row) => row.userName === "first-win").dailyXPDifference).toBe(2);
  expect(names(data.dailyLeaderboardXP)).not.toContain("banned");
  expect(names(data.dailyLeaderboardElo)).not.toContain("old-activity");
  expect(find.mock.calls[0][0]).toEqual({ lastCompletedGame: { $gte: new Date(nowMs - day) } });
  expect(rows[6].previousDayElo).toBe(1200);
  publish.mockResolvedValue({});
  const second = await refresh();
  expect(second.dailyLeaderboardElo).toEqual(data.dailyLeaderboardElo);
  expect(second.dailyLeaderboardXP).toEqual(data.dailyLeaderboardXP);
  expect(saved).toHaveLength(6);
});

it("retains XP and recent Rainbow as progression boards, including nonranked players", async () => {
  const rows = [
    player("casual-rainbow", {
      [fields.wins]: 0,
      [fields.losses]: 0,
      lastRankedGameAt: undefined,
      xpSeason: 12,
      games: [],
      isRainbowOverall: true,
      dateRainbowOverall: new Date(nowMs),
    }),
    player("older-rainbow", {
      lastRankedGameAt: undefined,
      isRainbowOverall: true,
      dateRainbowOverall: new Date(nowMs - day),
    }),
    player("undated-rainbow", { lastRankedGameAt: undefined, isRainbowOverall: true }),
    player("ten-xp", { xpSeason: 10 }),
    player("banned", { isBanned: true, xpSeason: 100, isRainbowOverall: true }),
  ];
  database(rows);
  const data = await refresh();
  expect(names(data.seasonalLeaderboardElo)).not.toContain("casual-rainbow");
  expect(data.seasonalLeaderboardXP).toEqual([{ userName: "casual-rainbow", xp: 12 }]);
  expect(names(data.rainbowLeaderboard)).toEqual(["casual-rainbow", "older-rainbow", "undated-rainbow"]);
  expect(data.rainbowLeaderboard[2].date).toEqual(new Date(0));
});

it("streams more than twenty candidates into the correctly sorted top twenty for all five boards", async () => {
  const rows = Array.from({ length: 45 }, (_, i) =>
    player(`p${i}`, {
      eloSeason: 1500 + i,
      xpSeason: 11 + i,
      isRainbowOverall: true,
      dateRainbowOverall: new Date(nowMs - (45 - i) * day),
    })
  );
  database(rows);
  const data = await refresh();
  const expected = rows
    .slice(-20)
    .reverse()
    .map((row) => row.username);
  for (const board of Object.values(data)) expect(names(board)).toEqual(expected);
});

it("skips nonfinite scores/differences without poisoning another board or aborting other baseline saves", async () => {
  const rows = [
    player("bad-elo", { eloSeason: Infinity, xpSeason: 3 }),
    player("bad-xp", { xpSeason: NaN }),
    player("overflow", { eloSeason: Number.MAX_VALUE, previousDayElo: -Number.MAX_VALUE }),
    player("failed-save"),
  ];
  const { publish } = database(rows);
  rows[3].save.mockRejectedValue(new Error("save failed"));
  const log = jest.fn();
  const data = await refresh(log);
  expect(names(data.dailyLeaderboardElo)).not.toContain("bad-elo");
  expect(names(data.dailyLeaderboardElo)).not.toContain("overflow");
  expect(names(data.dailyLeaderboardXP)).not.toContain("bad-xp");
  expect(names(data.dailyLeaderboardXP)).toContain("bad-elo");
  expect(log).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining("failed-save"));
  expect(publish).toHaveBeenCalledTimes(1);
});

it("publishes an empty seasonal snapshot at cutover instead of retaining the S24 board", async () => {
  const rows = [
    player("reset", {
      [fields.wins]: 0,
      [fields.losses]: 0,
      lastRankedGameAt: undefined,
      previousDayElo: 1600,
      previousDayXP: 0,
    }),
  ];
  const { publish } = database(rows);
  const data = await refresh();
  expect(data.seasonalLeaderboardElo).toEqual([]);
  expect(data.dailyLeaderboardElo).toEqual([{ userName: "reset", dailyEloDifference: 0 }]);
  expect(publish.mock.calls[0][1].payload.seasonalLeaderboardElo).toEqual([]);
});

it("rejects a failed snapshot write and rejects an invalid clock before querying", async () => {
  const { find, publish } = database([player("valid")]);
  publish.mockRejectedValue(new Error("snapshot unavailable"));
  await expect(refresh()).rejects.toThrow("snapshot unavailable");
  find.mockClear();
  await expect(refreshLeaderboards({ nowMs: NaN })).rejects.toThrow("clock");
  expect(find).not.toHaveBeenCalled();
});

it("refreshes progression standings hourly without resaving accounts or shortening the daily gain window", async () => {
  const row = player("active", { eloSeason: 1620, xpSeason: 12 });
  const { saved, find, snapshot } = database([row]);
  const first = await refresh();
  row.eloSeason = 1640;
  row.xpSeason = 17;
  row.isRainbowOverall = true;
  row.dateRainbowOverall = new Date(nowMs + 3600000);
  find.mockClear();
  const next = await refreshLeaderboards({ nowMs: nowMs + 3600000, log: jest.fn() });
  expect(next.seasonalLeaderboardElo).toEqual([{ userName: row.username, elo: 1640 }]);
  expect(next.seasonalLeaderboardXP).toEqual([{ userName: row.username, xp: 17 }]);
  expect(names(next.rainbowLeaderboard)).toEqual([row.username]);
  expect(next.dailyLeaderboardElo).toEqual(first.dailyLeaderboardElo);
  expect(next.dailyLeaderboardXP).toEqual(first.dailyLeaderboardXP);
  expect(saved).toEqual([row.username]);
  expect(row.previousDayElo).toBe(1620);
  expect(row.previousDayXP).toBe(12);
  expect(find).toHaveBeenCalledTimes(1);
  expect(find.mock.calls[0][1]).not.toHaveProperty("games");
  expect(snapshot().dailyUpdatedAt).toEqual(new Date(nowMs));
  expect(snapshot().updatedAt).toEqual(new Date(nowMs + 3600000));
});

it("rolls at 09:00 UTC rather than midnight and retains the result on same-period retries", async () => {
  const row = player("active", { eloSeason: 1620, xpSeason: 12 });
  const { saved } = database([row]);
  const first = await refresh();
  row.eloSeason = 1660;
  row.xpSeason = 20;
  const beforeReset = Date.parse("2026-09-09T08:59:59Z");
  row.lastCompletedGame = new Date(beforeReset);
  const before = await refreshLeaderboards({ nowMs: beforeReset, log: jest.fn() });
  expect(before.dailyLeaderboardElo).toEqual(first.dailyLeaderboardElo);
  expect(saved).toHaveLength(1);
  const atReset = beforeReset + 1000;
  const next = await refreshLeaderboards({ nowMs: atReset, log: jest.fn() });
  expect(next.dailyLeaderboardElo).toEqual([{ userName: row.username, dailyEloDifference: 40 }]);
  expect(next.dailyLeaderboardXP).toEqual([{ userName: row.username, dailyXPDifference: 8 }]);
  expect(saved).toHaveLength(2);
  expect((await refreshLeaderboards({ nowMs: atReset, log: jest.fn() })).dailyLeaderboardElo).toEqual(
    next.dailyLeaderboardElo
  );
  expect(saved).toHaveLength(2);
});

it("uses a legacy daily snapshot's timestamp instead of resetting gains on deployment", async () => {
  const row = player("active", { eloSeason: 1700 });
  const { saved, storeSnapshot } = database([row]);
  const oldDaily = [{ userName: "legacy", dailyEloDifference: 75 }];
  const dailyAt = new Date("2026-09-08T09:00:00Z");
  storeSnapshot({ payload: { ...Leaderboard.freshBoard(), dailyLeaderboardElo: oldDaily }, updatedAt: dailyAt });
  const data = await refresh();
  expect(data.dailyLeaderboardElo).toEqual(oldDaily);
  expect(saved).toEqual([]);
  expect(row.previousDayElo).toBeUndefined();
});

it("does not advance the saved daily marker on a failed intraday publication or reset baselines on retry", async () => {
  const row = player("active", { eloSeason: 1620, xpSeason: 12 });
  const { saved, publish, snapshot } = database([row]);
  const first = await refresh();
  const published = snapshot();
  publish.mockRejectedValueOnce(new Error("snapshot unavailable"));
  await expect(refreshLeaderboards({ nowMs: nowMs + 3600000, log: jest.fn() })).rejects.toThrow("snapshot unavailable");
  expect(snapshot()).toBe(published);
  expect(snapshot().dailyUpdatedAt).toEqual(new Date(nowMs));
  const retry = await refreshLeaderboards({ nowMs: nowMs + 3600000, log: jest.fn() });
  expect(retry.dailyLeaderboardElo).toEqual(first.dailyLeaderboardElo);
  expect(saved).toEqual([row.username]);
});

it("fails before scanning or rolling account baselines when the saved snapshot cannot be read", async () => {
  const { saved, find, publish, read } = database([player("active")]);
  read.mockImplementation(() => ({
    select: () => ({ lean: () => Promise.reject(new Error("snapshot unavailable")) }),
  }));
  await expect(refresh()).rejects.toThrow("snapshot unavailable");
  expect(saved).toEqual([]);
  expect(find).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});
