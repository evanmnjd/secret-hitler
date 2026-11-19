# Replay chat filters

Replay chat opens with public messages only. Its existing player, game, observer,
public, and whisper visibility controls remain independent. Text search is a
case-insensitive literal search across saved message text and participant names.
It searches the full loaded archive before displaying the latest 250 matches;
the match count explains this limit, and the existing entire-history control can
show every match. Loading the entire history can be slower for long games.

The player selector includes seated players, public authors, and archived whisper
participants. It selects public messages by that account and whispers involving
that account. The whisper-pair selector appears while whispers are enabled and
groups both directions of a conversation. It narrows whispers without affecting
public messages. Clear filters resets the search and selectors while preserving
channel visibility and the public subfilters.

Older whispers with no structured sender/recipient metadata appear under
**Unknown participants (legacy)**. They can be searched by their saved text, but
are not assigned to a named player's or pair's conversation by guessing from a
text prefix. Missing messages cannot be reconstructed from these controls.

Changing search, filters, or the replay board does not force the chat scroll
position to the bottom. Replacement transcript data follows the bottom only
while the viewer has not scrolled up. Sorting operates on a copy of the archive.
These filters only affect the replay display; live delivery and privacy are
unchanged. Saved chat timestamps retain their existing optional display; they do
not establish an exact chat-to-board-turn relationship for historical games.

Focused tests cover combined filters, full-archive search and render limits,
structured/staff/observer messages, legacy metadata, literal markup, and scroll
locking. Both CSS themes and the production JavaScript build are also checked.
