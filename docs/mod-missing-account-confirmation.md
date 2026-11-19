# Confirming actions for missing accounts

Account-targeted moderation actions now check the account collection before
submitting. An account without a public profile still counts as an existing
account. If no matching account exists, staff see the exact trimmed target name
and choose Cancel or Proceed anyway. Cancel preserves the username/selection and
comment; Proceed submits the original action payload through the existing handler.
Existing rules that require a valid IP or restrict a particular action still apply.

The check is available only to current moderators, editors and admins. The socket
handler reads the actor's current persisted staff role, accepts a bounded string
username, projects only the target's ID, and uses a query deadline. Trial/event
moderators, staff alts, former staff and ordinary accounts cannot use it. A request
does not write an account, action log or report.

Game UID actions, obfuscated-IP targets, IP-only actions and global operations
keep their existing behavior. The action determines whether it is game-scoped;
an account whose name happens to start with a game-action prefix is still checked.
Selected online accounts are checked even when their payload already includes an
obfuscated IP. User-targeted comments and stat-edit actions are checked too.

The client keeps one check in flight, ignores stale replies after a draft or
identity change, and times out without sending the action. A missing-account
confirmation is a typo safeguard, not a new requirement for the existing socket
action protocol. Directly submitted moderation actions retain their prior logic.

To verify manually, submit a comment or warning for a misspelled username and
cancel: the form should remain populated and no action should be logged. Repeat
and proceed: exactly the original action should be submitted. Test an existing
account with no profile, a lobby UID action and an obfuscated-IP timeout. Direct
socket attempts from trial/event moderators should receive an authorization error.
