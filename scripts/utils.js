export function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function getPlayerById(game, playerId) {
  if (!Array.isArray(game?.players) || !playerId) {
    return null;
  }

  return (
    game.players.find(
      (player) => player.player_id === playerId,
    ) ?? null
  );
}

export function getCurrentPlayer(game) {
  return getPlayerById(game, game?.current_player_id);
}