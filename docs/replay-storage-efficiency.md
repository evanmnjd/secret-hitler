# Smaller replay summaries without deleting history

New game summaries no longer allocate unused ObjectIds for each seat, turn or
Avalon settings object. Absent optional hand/claim/peek arrays also stay absent
instead of becoming empty arrays on every turn. The root game identity, vote and
deck arrays, message identifiers, chat archives and private reporting evidence are
unchanged. Existing records, including old nested IDs and unknown historical
metadata, remain readable. No migration or deletion runs at startup.

Run the offline measurement with `node scripts/replayStorageBenchmark.js`. It
does not connect to MongoDB. Measured BSON savings in the supplied fixtures:

| Fixture | Summary savings | Summary + representative chat archive savings |
| --- | ---: | ---: |
| Historical 7-player, 8-turn game | 778 bytes / 21.36% | 2.16% |
| Historical 8-player veto game, 19 turns | 2,169 bytes / 31.78% | 5.49% |
| Synthetic 10-player, 30-turn storage shape | 3,960 bytes / 43.26% | 9.46% |

Combined percentages use an explicitly synthetic 200-message archive and are not
measurements of the production dataset. MongoDB's existing WireTiger compression,
indexes, message volume and free-space reuse affect actual disk savings. This
change reduces future write volume; it does not reclaim historical storage.

Round-trip tests reconstruct replay phases from both old and compact records,
including veto games. Larger savings would require measuring production archive
composition and designing a separate, reversible historical compaction process.
Do not delete old replays or strip private evidence to apply this change.
