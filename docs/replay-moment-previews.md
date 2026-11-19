# Replay moment previews

Moment links use `/replay/<game UID>?turn=<government number>&phase=<phase>`. The
playback controls included on `replay-playback-timeline` create these links. An `end=1` parameter distinguishes
the final result from the preceding action when they share a phase.

The HTTP page includes Open Graph metadata and a 1200 × 630 PNG of the public
board at that exact moment. Discord can read this page without JavaScript.
Browsers continue to the same moment in `/game/` when signed in, or `/observe/`
otherwise. A visible link also works when JavaScript is disabled. Existing
`#/replay/<UID>` links continue to work, but their fragment cannot tell a crawler
which moment to preview.

The thumbnail shows policy tracks, the election tracker, seats, public offices,
votes at an election result, and players who were dead at that moment. It does
not include secret roles, policy hands, deck contents, investigation results,
chats, or a later winner. Unfinished live games are unavailable. Rendering uses
the same replay snapshots as browser playback, with existing local track art and
the project's existing Jimp dependency.

Production defaults to `https://secrethitler.io` for absolute preview URLs. Set
`PUBLIC_SITE_URL` to the public site's origin for another deployment;
`RENDER_EXTERNAL_URL` is also supported. Arbitrary request hostnames cannot
replace that origin. Local testing recognizes loopback hosts.

Preview work is bounded per server process: at most four concurrent reads and
reconstructions, two concurrent PNG renders, 30 new renders per minute, and 240
share-page/image requests per minute. Up to 16 PNGs are cached in memory for ten
minutes; identical renders already in progress share their result. Busy requests
receive an error and `Retry-After` instead of queuing unbounded work. Images are
not stored in MongoDB, and no remote image service is used.

Focused tests cover exact snapshot resolution, legacy replay reconstruction,
public-only fields, live-game guards, malformed links, PNG dimensions and board
pixels, crawler metadata, destinations, cache bounds, concurrency, and retries.
The real PNG codec runs in a Node child during the test because jsdom's emulated
byte operations are much slower than the server runtime.

A real Discord unfurl requires these routes to be deployed at a public address
that Discord can fetch. Local tests can verify Discordbot-style HTTP responses
and image bytes, but localhost links cannot unfurl for other users. No Discord
message or production deployment is performed by these changes.
