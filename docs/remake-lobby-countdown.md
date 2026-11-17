# Remade lobby countdown

Remade lobbies wait a full 20 seconds once they have a permitted player count,
including when all seats are already filled. During that window they remain
waiting lobbies: players can use the normal Leave Game action, and roles are not
assigned. Filling the final seat does not shorten the countdown.

If leaving or disconnecting drops the roster below its minimum or into an
excluded player count, the countdown stops. A newly eligible roster gets a fresh
20 seconds. Staff freezes pause the remaining time, and deleted/replaced/closing
lobbies cannot start from an old timer.

At expiry the existing start initialization and role reveal run without a second
five-second countdown. Normal lobbies and tournaments retain their existing
timing, and remake-vote thresholds are unchanged. This is a lobby grace period;
it does not introduce a new client-ready acknowledgement protocol.
