# Hourly standings with daily gain baselines

The Render leaderboard cron now runs hourly in its separate process. Seasonal Elo,
XP and recent Rainbow standings refresh on that schedule; daily gain standings
and per-account daily baselines still roll once per 09:00 UTC period. Intraday
refreshes reuse the last daily board and do not rewrite account baselines. The UI
states these two schedules explicitly.

The web service retains its existing 60-second cache and does not run scans or
expose an on-demand refresh endpoint. Each scan uses field projections rather than
loading account histories. Compared with daily operation, read scans occur more
often, but the per-account baseline writes remain daily. Actual scan duration and
Atlas load should be monitored after deployment; this branch makes no claim about
production capacity without those measurements. Applying the cron schedule in the
hosting configuration is required for the new frequency to take effect.

The published snapshot stores `dailyUpdatedAt` only on a successful publication.
Legacy daily snapshots use their prior publication time as the first rollover
marker. As before, baseline updates and snapshot publication are not a single
transaction: a failure between them can affect the displayed daily movement. This
branch does not introduce a database transaction or repair historical baselines.
Overlapping cron executions should remain disabled by the host's single-job
execution policy. Merely opening or refreshing the browser cannot trigger scans.
