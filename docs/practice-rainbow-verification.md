# Practice-only Rainbow promotion

The reported historic bug is already fixed in the `rc-s25.1` base (`b275253c`).
`routes/socket/game/end-game.js` uses the same `applyXpAndRainbow` helper for
ranked results and Practice results. Practice wins award 2 XP and losses award
1 XP. Each XP track grants its Rainbow flag at **10 or more XP**, independently.
The persisted account and the connected player list are updated without needing
a ranked game or reconnect.

This branch adds regression coverage for the exact reported cases: reaching
10 XP, jumping from 9 to 11 XP, losing into the threshold, and legacy accounts
with 10, 11 or 500 XP whose flags are still false. The tests finish a Practice
game through the real completion handler, apply real Mongoose writes to isolated
stored records, reload them, and verify flags, badges, the promotion timestamp,
live player-list state and unchanged ranked statistics. They do not query a
production database or prove which code is deployed there.

A previously stuck account should become Rainbow on its next completed Practice
game. A bulk repair of historical accounts is not necessary to fix current
progression and is not performed by this branch. If a player still reproduces
the issue, check the deployed revision and whether they mean seasonal versus
lifetime XP/Rainbow; those tracks deliberately qualify independently.
