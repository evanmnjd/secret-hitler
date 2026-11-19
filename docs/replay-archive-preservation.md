# Replay archive preservation

Branch: `replay-archive-preservation`, built on `replay-storage-efficiency`.

The existing MongoDB summary and saved-game collections remain in use. The compact summary schema and legacy replay reader are unchanged. New summary/transcript writes record optional `archiveVersion: 1`; old records stay versionless when read. Saved transcripts also record whether a summary was expected, so deliberately transcript-only private, development, and waiting tables can be distinguished from missing data in new archives.

Completion and teardown now share one writer per game UID. It allows one active job and one coalesced pending job, retaining the newest chats without accumulating a chain of snapshots. Summary and transcript writes are independent, but deletion waits for both required records. Transient network/version/duplicate-key failures receive at most three attempts with fresh database reads. Successful summaries are marked saved only after Mongo acknowledges the write. A failed pair remains in memory for the existing collector to retry, without repeating profile or rating updates. Original summary data is still saved if profile reconstruction fails.

A permanently invalid or missing required summary needs manual review; the collector retains and retries the available data rather than automatically discarding it.

This protects against failed writes while the process is running; it cannot recover data already deleted or guarantee preservation if the process exits during a database outage. No migration, deletion job, additional service, automatic archive audit, or compression format is introduced.

## Read-only audit

Set `MONGO_URL` explicitly, then run:

```sh
node scripts/auditReplayArchives.js --limit 100
node scripts/auditReplayArchives.js --uid GAME_UID
```

The command samples at most 1,000 records per collection, reads one complete summary at a time, never fetches chat arrays, disables automatic indexes, and limits database connection/query time. It reports missing pairs, unexpected versions, duplicate transcripts in the sample, and reconstruction warnings as JSON. Legacy records without an expected-summary marker are reported as unavailable-or-intentional rather than declared lost. It performs no writes, repairs, or removals; parser warnings are a reason to inspect an archive, never discard it. Sampling does not establish that the entire database is healthy.

## Verification

Focused tests exercise transient and permanent failures, lost acknowledgements, duplicate summaries, bounded/coalesced writes, teardown retention/retry, malformed-table metadata preservation, original-data preservation despite reconstruction failure, compact/legacy replay compatibility, and the audit command's read-only contract.
