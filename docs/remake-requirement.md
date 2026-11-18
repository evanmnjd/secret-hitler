# Post-game remake votes and handoff

Completed non-tournament games need one vote to open a remake lobby. The existing
multi-player quorum still applies during play, and tournament cancellation keeps
its existing threshold. Vote withdrawal, Leave Game and disconnect all use the
same requirement, so one remaining post-game voter can continue the remake.

The original remake vote countdown, reveal delay and new-lobby startup timing are
unchanged. The experimental 20-second lobby countdown has been removed.

At transfer the server rechecks current votes, player presence and active sockets.
Departed players do not retain ghost seats; replaced sockets transfer through the
current connection, and a remake with no remaining voters creates no empty lobby.
Only players still voting transfer; a one-vote remake waits for enough players
under the lobby's existing player-count settings.
