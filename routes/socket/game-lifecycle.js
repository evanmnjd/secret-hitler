// Observers do not keep an abandoned table alive. Started games retain departed
// players in their roster, so its length (and general.playerCount) is not occupancy.
const hasRemainingPlayers = (game) => {
  const players =
    game.general.isTourny && game.general.tournyInfo?.round === 0
      ? game.general.tournyInfo.queuedPlayers
      : game.publicPlayersState;
  return players.some((player) => !player.leftGame && player.connected !== false);
};

module.exports = { hasRemainingPlayers };
