const mongoose = require("mongoose");
const Account = require("../models/account");
const Leaderboard = require("../models/leaderboard");
const { STARTING_PUBLIC_RATING } = require("../routes/socket/rating/public-ladder");
const { CURRENT_SEASON_FIELDS } = require("../src/shared/season");
const { rankedSeasonEligibility } = require("../src/shared/ranked-eligibility");

// Standalone Render cron: persist the existing five-board payload for /leaderboardData.json.
// Re-entry is visible after the next cron refresh (R2), without changing the web service/cache.
// Usage: MONGO_URL="mongodb+srv://..." node scripts/retrieveLeaderboardData.js
const BOARD_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_RESET_OFFSET_MS = 9 * 60 * 60 * 1000;
const dailyPeriod = (time) => Math.floor((time - DAILY_RESET_OFFSET_MS) / DAY_MS);
const DAILY_FIELDS = {
  username: 1,
  isBanned: 1,
  eloSeason: 1,
  xpSeason: 1,
  previousDayElo: 1,
  previousDayXP: 1,
};
const BOARD_FIELDS = {
  username: 1,
  isBanned: 1,
  eloSeason: 1,
  xpSeason: 1,
  isRainbowOverall: 1,
  dateRainbowOverall: 1,
  lastRankedGameAt: 1,
  [CURRENT_SEASON_FIELDS.wins]: 1,
  [CURRENT_SEASON_FIELDS.losses]: 1,
};

// Stream the account scan and retain only each board's top rows, not the full eligible population.
const addLeader = (board, entry, field) => {
  board.push(entry);
  board.sort((a, b) => b[field] - a[field]);
  if (board.length > BOARD_LIMIT) board.pop();
};

const refreshLeaderboards = async ({ nowMs = Date.now(), log = console.log } = {}) => {
  if (!Number.isFinite(nowMs)) throw new Error("Leaderboard clock must be finite epoch milliseconds");
  const data = Leaderboard.freshBoard();
  const previous = await Leaderboard.findById("current").select("payload updatedAt dailyUpdatedAt").lean();
  // Legacy snapshots were produced by the daily cron, so their publication time is a
  // valid rollover marker. Hourly refreshes must not repeatedly reset daily gains.
  const lastDailyUpdate = previous && (previous.dailyUpdatedAt || previous.updatedAt);
  const lastDailyMs = lastDailyUpdate ? new Date(lastDailyUpdate).getTime() : NaN;
  const refreshDaily =
    !Number.isFinite(lastDailyMs) ||
    dailyPeriod(lastDailyMs) < dailyPeriod(nowMs) ||
    !Array.isArray(previous?.payload?.dailyLeaderboardElo) ||
    !Array.isArray(previous?.payload?.dailyLeaderboardXP);
  if (!refreshDaily) {
    data.dailyLeaderboardElo = previous.payload.dailyLeaderboardElo.slice();
    data.dailyLeaderboardXP = previous.payload.dailyLeaderboardXP.slice();
  }

  // R7: daily Elo/XP movement uses general completion activity, including casual/practice XP.
  // Only the ranked seasonal board below requires lastRankedGameAt. Roll daily baselines even for
  // players absent from that board, so their movement does not repeat on the next refresh.
  if (refreshDaily)
    await Account.find({ lastCompletedGame: { $gte: new Date(nowMs - DAY_MS) } }, DAILY_FIELDS)
      .cursor()
      .eachAsync(async (account) => {
        if (!account.isBanned) {
          // Zero/negative public accumulators are valid; only absent/nonfinite baselines start fresh.
          if (Number.isFinite(account.eloSeason)) {
            const baseline = Number.isFinite(account.previousDayElo) ? account.previousDayElo : STARTING_PUBLIC_RATING;
            const difference = account.eloSeason - baseline;
            if (Number.isFinite(difference))
              addLeader(
                data.dailyLeaderboardElo,
                { userName: account.username, dailyEloDifference: difference },
                "dailyEloDifference"
              );
          }
          if (Number.isFinite(account.xpSeason)) {
            const baseline = Number.isFinite(account.previousDayXP) ? account.previousDayXP : 0;
            const difference = account.xpSeason - baseline;
            if (Number.isFinite(difference))
              addLeader(
                data.dailyLeaderboardXP,
                { userName: account.username, dailyXPDifference: difference },
                "dailyXPDifference"
              );
          }
        }
        account.previousDayElo = account.eloSeason;
        account.previousDayXP = account.xpSeason;
        try {
          await account.save();
        } catch (err) {
          // Preserve the existing per-account failure isolation; one failed baseline must not abort
          // publication for everyone else. A failed account may report its movement again on retry.
          log(err, `[leaderboard] failed to roll daily baseline for ${account.username}`);
        }
      });

  // R7: the ranked Season board reads dedicated ranked activity through the pure predicate.
  // XP and recent Rainbow are progression boards, so casual XP remains meaningful there. Neither
  // the old lifetime games-array gate nor the ranked activity window governs those boards.
  await Account.find({ isBanned: { $ne: true } }, BOARD_FIELDS)
    .lean()
    .cursor()
    .eachAsync((account) => {
      if (account.isBanned) return;
      if (rankedSeasonEligibility(account, nowMs).eligible && Number.isFinite(account.eloSeason)) {
        addLeader(data.seasonalLeaderboardElo, { userName: account.username, elo: account.eloSeason }, "elo");
      }
      // Keep the existing XP cutoff independent of the provisional ranked-game count.
      if (Number.isFinite(account.xpSeason) && account.xpSeason > 10) {
        addLeader(data.seasonalLeaderboardXP, { userName: account.username, xp: account.xpSeason }, "xp");
      }
      if (account.isRainbowOverall) {
        const date = account.dateRainbowOverall;
        addLeader(
          data.rainbowLeaderboard,
          {
            userName: account.username,
            date: date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date(0),
          },
          "date"
        );
      }
    });

  await Leaderboard.findByIdAndUpdate(
    "current",
    {
      payload: data,
      updatedAt: new Date(nowMs),
      dailyUpdatedAt: refreshDaily ? new Date(nowMs) : new Date(lastDailyMs),
    },
    { upsert: true }
  );
  log("[leaderboard] updated", {
    seasonalElo: data.seasonalLeaderboardElo.length,
    seasonalXP: data.seasonalLeaderboardXP.length,
    dailyElo: data.dailyLeaderboardElo.length,
    dailyRefreshed: refreshDaily,
    rainbow: data.rainbowLeaderboard.length,
  });
  return data;
};

const main = async () => {
  mongoose.Promise = global.Promise;
  try {
    await mongoose.connect(process.env.MONGO_URL || "mongodb://localhost:27017/secret-hitler-app");
    await refreshLeaderboards();
  } finally {
    await mongoose.connection.close();
  }
};

// Importing the refresh for tests must not start a connection or exit the hosting process.
if (require.main === module) {
  main().catch((err) => {
    console.log("[leaderboard] fatal:", err);
    process.exitCode = 1;
  });
}

module.exports = { refreshLeaderboards };
