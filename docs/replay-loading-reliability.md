# Replay loading and recovery

Replay boards distinguish missing archives from connection, server, timeout, and
damaged-archive failures. Retry keeps the requested replay and exact moment.
Malformed summaries are caught without stopping the replay watcher, and delayed
responses cannot replace another replay or reopen one after Exit Replay.

The board initially requests only the small saved table metadata. Its archived
transcript is requested on the first **Show chats**, then retained while that
replay remains selected. Chat has its own loading, unavailable, and retry states,
so a missing transcript does not prevent viewing the board. Switching replays
clears the prior metadata and transcript.

Socket acknowledgements belong to the individual request. The old transcript
event remains available for older clients. Database queries use projections and
execution limits; a response deadline and one pending request per data kind and
socket prevent retries from stacking additional reads on a stalled connection.
Metadata never retrieves chat. Transcript responses continue to check current
staff authorization, reject live unfinished games, and filter hidden information.
All saved neighbor conversations are available only through completed replays.

Verification covers HTTP errors, malformed JSON/summaries, timeout and retry,
exact-moment retry, stale responses, exit during loading, lazy transcript loading,
empty versus unavailable chat, database bounds, and live/role privacy guards.

```sh
pnpm test --runInBand src/frontend-scripts/replay/replay-loading.test.js src/frontend-scripts/components/section-main/replay/replay-chat.test.js __test__/backend/routes/game-summary-loading.test.js __test__/backend/routes/socket/neighbor-chat-privacy.test.js __test__/backend/routes/socket/user-requests.test.js
```
