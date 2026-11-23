# Hidden-vote result cards

Games with **No vote reveal** now show a compact chat row containing the existing
Ja/Nein vote-card emotes and the numeric tally. Cards are grouped Ja first, then
Nein. They do not identify seats or players. Only the aggregate totals are added
to the public result message; individual ballots remain hidden during the game.

The first card starts in the same column on each row. Timestamps follow the result
instead of shifting the card columns. The tally wraps when space is limited, and
the card row supports all 5–10 starting player counts and smaller living counts.
The same renderer is used in live chat and saved replay chat. Existing archives
without structured counts retain their readable text. No archive migration is
needed, and ordinary visible-ballot games keep their existing display.

Result delivery remains independent of experienced mode, silent/emote-only player
chat, and disabled game chat. Eliminated players do not count; a living player's
normal or timer-forced ballot does. Results appear only after voting and the
existing reveal delay have finished.

While verifying disabled game chat, a separate reset was found inside the
pass/fail-message condition. The pending chancellor selection is now cleared
after every failed election, including when that message is disabled, allowing
the next government to be nominated normally.

Tests exercise aggregate-only data, reveal timing, player and observer delivery,
5–10 players, eliminated seats, mode combinations, forced ballots, subsequent
nominations, both chat renderers, legacy rows, and compact accessible rendering.
