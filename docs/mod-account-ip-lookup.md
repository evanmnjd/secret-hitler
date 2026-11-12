# Account IP lookup for moderation

“See Account IPs” uses the existing username/selected-player field. It shows the
signup IP and last-connected IP separately, in the same obfuscated form used by
the moderation interface. Each missing or malformed historical field displays
“Unavailable”; a nonexistent account has a distinct message.

The lookup reads the Account directly. It does not require a profile or any
completed public games, and does not create a profile, modify the account,
write a moderation log entry or send a webhook. Existing raw-IP and IP/lobby
action paths are unchanged.

Only current moderators, editors and admins can use the lookup. Trial, event,
tournament, former staff and ordinary accounts are excluded. The socket handler
checks the persisted actor role before and after the account query and refuses
stale/replaced sockets. It returns only explicitly obfuscated IP fields; query
errors are not logged or exposed with their underlying data.

Queries are projected, use a two-second database time limit, and permit only one
pending lookup per socket. The UI cancels stale displays when the target, role
or socket changes, and provides a ten-second timeout/retry path.
