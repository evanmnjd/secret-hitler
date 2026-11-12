# Read-only account ban status

Moderators, editors and admins can enter a username in Moderation and choose
**Check Ban Status** without entering an action comment. The result distinguishes
a banned account, an existing unbanned account and a username that does not exist.
The lookup reads `Account.isBanned` directly, so accounts without profiles or
public game history work too. A missing legacy flag means not banned.

This lookup does not change the account, create a profile, write a moderation
action or send a notification. Existing Ban user and other moderation actions
retain their behavior.

The server verifies the requesting account's current persisted staff role for
every lookup. Trial moderators, event/tournament moderators, ordinary users and
anonymous sockets are denied, including sockets with stale admin claims. Queries
use projections and execution time limits, and requests are serialized per
socket with a short cooldown. Client errors are distinct from account-not-found.
The UI suppresses stale replies after changing usernames, losing permission,
timing out or leaving the page.

The feature branch is independently based on `rc-s25.1`. Focused backend/frontend
tests exercise the actual registered listener body, role denials, missing/legacy
accounts, query errors, read-only behavior, request guards and UI lifecycle.
