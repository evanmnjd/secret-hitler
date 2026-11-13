# Local test environment

Use Node.js **24.12 or newer** and the repository's pinned pnpm. Application
dependencies belong in each checkout; pnpm reuses its shared package store.
There is no need to install React, Mongoose or other app libraries globally.

## Get a separate checkout with all the fixes

From your existing repository folder, with `origin` pointing to
`https://github.com/evanmnjd/secret-hitler.git`:

```sh
git fetch origin all-fixes-local-testing
git worktree add -b local/all-fixes ../secret-hitler-test FETCH_HEAD
cd ../secret-hitler-test
corepack pnpm install --frozen-lockfile
```

`all-fixes-local-testing` combines the individual fix branches and these tools
for local review. Individual pull requests can still use their original branches.
`local-testing-fixtures` contains just the local tooling, based on `rc-s25.1`.
Neither branch needs to be deployed to test it.

If Corepack is missing, install it once with `npm install --global corepack`.
Use `corepack pnpm` for the commands below; `pnpm` alone also works when enabled.
If this repo uses a different remote, add your fork as another remote and use
that remote's branch instead of changing your old checkout's origin.

## Start MongoDB and Redis

Your already-running local MongoDB and Redis are sufficient. If they are stopped,
start them using your existing setup. Default ports are 27017 and 6379.

Alternatively, with Docker Desktop/Docker Compose installed:

```sh
corepack pnpm local:services
```

This starts the supplied MongoDB 7 and Redis 7 services, bound to your computer's
loopback interface. Skip this command if your existing services already occupy
those ports. The compose project has its own persistent volumes.

## Populate the database and run the app

For everyday use, open the launcher in the project folder:

| Computer | Launcher |
| --- | --- |
| Windows | Double-click `Start Local Test.cmd` |
| macOS | Double-click `Start Local Test.command` |
| Linux | Run `Start Local Test.sh` in a terminal, or choose Run in Terminal in your file manager |

It installs/updates this checkout's dependencies, starts missing default MongoDB
or Redis services through Docker Compose when needed, seeds the demo data without
resetting an existing dataset, starts the app and opens your browser when ready.
Keep its window open while testing; Ctrl+C stops the app. Database services and
saved data remain available for the next launch.

Node.js and Corepack must be installed once. If you use Docker for the database
services, open Docker Desktop first. If MongoDB and Redis already run through
your existing setup, the launcher reuses them. It never replaces or stops an
already-running database service. Custom service ports must already be running.
If another app occupies the selected web port, close it first or use
`LOCAL_TEST_PORT` as described below.

There is **no hosting fee** for this local setup. It runs on your own computer,
which must stay on while you use it. You do not need Render, Atlas, a paid hosting
plan or a domain for local testing.

The same launcher can also be started with `corepack pnpm local:launch`. To use
the individual steps manually instead:

```sh
corepack pnpm local:seed
corepack pnpm local:test
```

Open **http://127.0.0.1:8080/game/**. The launcher builds the assets before serving
the first page and then watches for source changes. Stop your old app server if
it uses the same port. Press Ctrl+C to stop this server.

The local launcher ignores `.env` and generic `MONGO_URL`, `REDIS_URL` and `PORT`
values. It selects `mongodb://127.0.0.1:27017/shio-local-testing`, including the
development session store, and only listens on `127.0.0.1`. OAuth/email/webhook
configuration from your shell is not needed. Redis settings use the application's
existing database index 11; use a separate Redis service/port if you need settings
isolated from another simultaneously running checkout.

All demo accounts use the password **`LocalTest123!`**:

| Account | Purpose |
| --- | --- |
| `LocalDemoAdmin` | Moderation log, player reports, admin Elo settings |
| `LocalDemoMod`, `LocalDemoEditor`, `LocalDemoTrialMod` | Other staff roles |
| `LocalDemoContributor` | Contributor color and profile |
| `LocalDemoPlayer01` through `LocalDemoPlayer22` | Ordinary players with varied ratings and XP |
| `LocalDemoPractice09` | 9 XP; finish a Practice game to cross the Rainbow threshold |
| `LocalDemoPractice500` | Deliberately stale Rainbow flags at 500 XP; a Practice completion repairs them |
| `LocalDemoSeasonReset` | Lifetime Rainbow with zero seasonal XP |

The seed creates **30 accounts, 30 profiles, 36 saved games and replay summaries,
1,500 moderation actions, one report with neighbor evidence, and leaderboards**.
Seven accounts have enough generated ranked history to appear on the seasonal
ladder. Profile statistics and recent-game links derive from the saved outcomes.
The Elo/XP display baselines and added deck snapshots are synthetic test data,
not a simulation of a historical production season or real shuffled decks.

The full account/scenario reference is written to the ignored
`.local-testing/shio-local-testing-fixtures.json` file. It contains the demo
password, counts and replay identifiers.

## What to try

| Change | Local scenario |
| --- | --- |
| Replay button frame | Open `http://127.0.0.1:8080/game/#/replay/LocalDemoGame25`; resize the browser and toggle deck, roles, chat and playback. |
| Public replay neighbor chat | The same replay contains three whispers from two pairs. Public chat appears by default; use Show whispers to add conversations and Hide public chat for whispers only. Compare participant, unrelated and logged-out views. |
| Silent-neighbor replay | `LocalDemoGame26` is the saved silent-neighbor fixture. Live silent chat behavior requires creating a new lobby. |
| Veto/legacy compatibility | Replays `LocalDemoGame30`, `LocalDemoGame31` and `LocalDemoGame35` cover two veto cases and a legacy replay. |
| Mod sorting and pagination | Log in as `LocalDemoAdmin`, open Moderation, sort all six headers and page through the 1,500 synthetic actions. Dates span several weeks. |
| Admin Elo toggles | Change Staff Settings; watch the admin's row from another logged-in browser. |
| Profiles and leaderboards | Open player profiles, follow recent-game links, and open Leaderboards. The initial snapshot is generated by the existing refresh function. |
| Practice Rainbow | Use one of the Practice accounts above in a newly played Practice game. The fixture deliberately does not grant the achievement in advance. |
| Lobby cleanup and icon order | Create new public/private/neighbor lobbies through the UI. Leave, disconnect or remake them; timer and Elo should be the final icons. |
| Replay storage | Run `node scripts/replayStorageBenchmark.js` on the combined branch for the offline BSON measurement. |

Use separate browser profiles or browser account containers when comparing users.
One incognito session can provide a second identity, but separate incognito
windows usually share cookies with each other. Normal tabs in the same browser
profile also share login cookies.

## Populate the online user list or seat waiting players

Keep the app running, then open a second terminal in the same checkout:

```sh
corepack pnpm local:players
```

Eight ordinary demo accounts log in through the normal routes and stay online.
They use distinct synthetic forwarded IPs in requests sent only to the local
server, so the moderation user table can show different live test addresses too.
This is local request simulation, not eight different real network connections.
Use `LocalDemoAdmin` or `LocalDemoPlayer09` in your own browser while those eight
accounts are connected; logging in as a helper account replaces its connection.

To seat four of them in a waiting lobby you created, copy its UID from the table
URL and run:

```sh
corepack pnpm local:players --count 4 --game YOUR_LOBBY_UID
```

The helper checks available seats before joining. These clients do not chat, vote
or play the game for you; they are useful for presence, lobby and start/leave
tests. Press Ctrl+C in that terminal to disconnect all helper accounts. Use
separate real browser sessions when you need to control every player in a game.

Saved games are **history/replays**, not active lobbies or online players. The
home-screen lobby list lives in server memory, so create fresh lobbies to test
joining/leaving/remakes. Seeded moderation rows describe fake historical actions;
they do not actually ban, warn or change the accounts.

Each account has distinct documentation-range synthetic signup/history IPs, and
the mod log also contains varied IPs. A real request from your browser still
originates from localhost. Visiting `/game/` updates the account's last-connected
IP normally; seeding a field does not give your computer a different network IP.

## Rerun, reset, or remove the fixtures

Stop the local app before changing fixtures, then restart it afterward so its
cached staff and presence data refreshes.

```sh
# Safe repeat: an already-complete dataset is left unchanged.
corepack pnpm local:seed

# Restore the demo dataset, including login passwords.
corepack pnpm local:seed --reset

# Create more moderation history when resetting (maximum 10,000).
corepack pnpm local:seed --reset --mod-actions 5000

# Remove only the generated, manifest-owned records.
corepack pnpm local:clean
```

Cleanup never drops a database or deletes records by a username prefix. A small
ownership marker stays in the database for later reseeding. New playtest records
you create separately are preserved; cleanup is not a full reset of every game
you play. Modified shared leaderboard snapshots and other accounts' daily
baselines are preserved too. If other accounts or a preserved snapshot exist,
reseed skips the global leaderboard refresh and explains that in its output.

The first seed requires an empty database. If a database already contains data
without this tool's ownership marker, choose another local test database instead
of overwriting it. An interrupted seed retains its planned IDs for `--clean` or
`--reset`. Commands hold a database lock; after an abrupt process termination,
that lock expires in five minutes.

## Optional local overrides

These overrides work across Windows, macOS and Linux through the already-installed
`cross-env` dependency:

```sh
corepack pnpm exec cross-env LOCAL_TEST_PORT=8081 corepack pnpm local:test

corepack pnpm exec cross-env LOCAL_TEST_MONGO_URL=mongodb://127.0.0.1:27018/shio-local-testing-demo corepack pnpm local:seed
corepack pnpm exec cross-env LOCAL_TEST_MONGO_URL=mongodb://127.0.0.1:27018/shio-local-testing-demo LOCAL_TEST_REDIS_URL=redis://127.0.0.1:6380 LOCAL_TEST_PORT=8081 corepack pnpm local:test
```

Only loopback Mongo hosts and database names `shio-local-testing` or
`shio-local-testing-<suffix>` are accepted. The tools refuse `NODE_ENV=production`,
Atlas/SRV URLs, credentials and other database names, including your old
`secret-hitler-app` database. Use the same overrides for seed, app and cleanup.

To stop only the optional compose services while preserving their volumes:

```sh
corepack pnpm local:services:stop
```

## Switching branches afterward

Save your edits before switching branches, fetch the new branch, and rerun the
frozen-lockfile installation. This reuses pnpm's package cache; don't copy or
globally install the other checkout's app dependencies. Branches without these
tooling commits won't have `local:*` commands. Use the combined test branch for
the easiest all-fixes review, or cherry-pick the tooling commit onto your own
development branch.

After updating the checkout, stop the app with Ctrl+C and open the launcher again
to rebuild the browser files. Local testing adds a new asset URL token on every
server start and revalidates public files on each request, so an older cached
interface does not hide newly added controls. This applies only to local testing;
production and ordinary development retain their existing cache behavior.
