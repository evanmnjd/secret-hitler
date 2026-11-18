// Completed tables only need one player to open a remake lobby. Tournament
// cancellation and votes during play keep their existing quorum.
const minimumRemakeVotes = (game) =>
  game.gameState.isCompleted && !game.general.isTourny
    ? 1
    : (game.customGameSettings.fascistCount && game.general.playerCount - game.customGameSettings.fascistCount) ||
      Math.floor(game.general.playerCount / 2) + 2;

module.exports = { minimumRemakeVotes };
