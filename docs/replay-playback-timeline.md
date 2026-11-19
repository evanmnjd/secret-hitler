# Replay playback and moment links

The replay board and seats keep their existing layout. Opening chat leaves a compact playback row and the timeline above the transcript. The six playback buttons and their existing keyboard shortcuts still work while chat is open. Closing chat restores the detailed turn, phase and description controls.

The timeline contains every government, including failed elections, followed by its executive power when applicable. Investigation, policy peek, special election, execution and assassination are separate buttons in chronological order. A final Result button distinguishes the winning board from the preceding snapshot. The current milestone is highlighted; the row scrolls horizontally on narrow screens. Buttons support normal keyboard focus and activation.

**Copy link to this moment** copies an absolute URL such as `/replay/table-id?turn=3&phase=investigation`. `turn` is one-based. The final result additionally includes `end=1` because replay data can have two snapshots with the same government and phase. If clipboard permission is unavailable, the UI displays the exact URL in a selectable field. Copy success is reported only after the browser confirms the copy.

Existing `#/replay/table-id` links still open at the beginning. A moment hash such as `/game/#/replay/table-id?turn=3&phase=investigation` opens at its exact saved snapshot. Invalid or unavailable moments show an error and a link to restart from the beginning when the replay ID is known. They never silently select a different moment.

This branch includes the public `/replay/:uid` landing route and Discord thumbnail so copied URLs and exact-moment playback work together. The UI uses the same shared moment parser as that route. Neither the timeline nor moment links change archived data or expose unfinished games. Public-only chat remains the default; replay whisper visibility controls are unchanged.

## Local checks

```sh
pnpm exec jest --runInBand src/shared/replay-moment.test.js src/frontend-scripts/components/section-main/replay/replay-timeline.test.js src/frontend-scripts/components/section-main/replay/replay-moment-link.test.js src/frontend-scripts/components/section-main/replay/replay-controls.test.js src/frontend-scripts/components/section-main/replay/replay-chat.test.js __test__/frontend/replay-moment-routing.test.js
pnpm lint
pnpm build
pnpm build-css:dark
pnpm build-css:web
```

For manual verification, open a completed replay with failed elections and powers. Open chat and move through the replay using both the transport and timeline. Copy a power link and a Result link, then open each in a fresh tab and compare the board. Try an unknown phase or a government beyond the archive to confirm the error state. Verify the same flow in both site themes and on a narrow viewport.
