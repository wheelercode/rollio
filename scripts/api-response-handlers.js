import { state } from "./state.js";
import {
  getReturnedRolledDice,
  getTraySize,
  placeDiceInEntireTray,
  placeRolledDiceInOpenSlots,
} from "./dice-tray.js";

function clonePlayer(player) {
  return player && typeof player === "object" ? { ...player } : null;
}

function findOpponent(players, currentPlayer) {
  if (!Array.isArray(players) || !currentPlayer) return null;

  return players.find((player) => player.name !== currentPlayer.name) || null;
}

function applyServerState(data = {}, { applyRolledDice = false } = {}) {
  const turn = data.turn && typeof data.turn === "object" ? data.turn : {};

  if (Array.isArray(data.players)) {
    state.players = data.players.map((player) => ({ ...player }));
  }

  const returnedCurrentPlayer = data.current_player ?? turn.player;
  if (returnedCurrentPlayer) {
    state.currentPlayer = clonePlayer(returnedCurrentPlayer);
  }

  const returnedOpponent =
    data.opponent ?? findOpponent(state.players, state.currentPlayer);

  if (returnedOpponent) {
    state.opponent = clonePlayer(returnedOpponent);
  }

  if (data.target_score !== undefined) {
    state.targetScore = data.target_score;
  }

  if (turn.state !== undefined) {
    state.turnState = turn.state;
  } else if (data.state !== undefined) {
    state.turnState = data.state;
  }

  if (turn.base_score !== undefined) {
    state.turnScore = turn.base_score;
  } else if (data.base_score !== undefined) {
    state.turnScore = data.base_score;
  }

  if (turn.roll_number !== undefined) {
    state.rollNumber = turn.roll_number;
  } else if (data.roll_number !== undefined) {
    state.rollNumber = data.roll_number;
  }

  const returnedScoredDice =
    turn.scored_dice ?? data.scored_dice ?? data.scoring_dice;

  if (Array.isArray(returnedScoredDice)) {
    state.scoredDice = [...returnedScoredDice];
  }

  if (applyRolledDice) {
    const returnedRolledDice = getReturnedRolledDice(data);

    if (returnedRolledDice) {
      placeRolledDiceInOpenSlots(returnedRolledDice);
    }
  }
}

function resetTurnModel({ preserveDice = false } = {}) {
  state.turnState = "READY_TO_ROLL";
  state.turnScore = 0;
  state.rollNumber = 0;

  if (!preserveDice) {
    state.rolledDice = Array(getTraySize()).fill(null);
    state.displayedDice = Array(getTraySize()).fill(null);
  }

  state.scoredDice = [];
  state.heldIndexes = new Set();
  state.selectedIndexes = new Set();
  state.selectionIsValid = false;
  state.selectedScore = 0;

  if (!preserveDice) {
    state.rollioActive = false;
  }
}

export function handleGameStarted(_eventData, apiResponse) {
  resetTurnModel();

  state.gameStarted = true;
  state.activeScreen = "game";

  applyServerState(apiResponse.game);

  if (!state.turnState) {
    state.turnState = "READY_TO_ROLL";
  }

  state.message =
    `${state.currentPlayer?.name ?? "Player 1"}, ` +
    "press Roll to begin.";
}

export async function handleDiceRolled(data, apiResponse) {
  if (state.rollAnimationPromise) {
    await state.rollAnimationPromise;
    state.rollAnimationPromise = null;
  }

  const returnedDice = getReturnedRolledDice(data);

  if (data.rollio) {
    if (returnedDice) {
      if (returnedDice.length === getTraySize()) {
        placeDiceInEntireTray(returnedDice);
      } else {
        placeRolledDiceInOpenSlots(returnedDice);
      }
    }

    resetTurnModel({ preserveDice: true });
    applyServerState(apiResponse.game);

    state.rollioActive = true;
    state.heldIndexes = new Set();
    state.selectedIndexes = new Set();
    state.selectionIsValid = false;
    state.selectedScore = 0;

    if (!state.turnState) {
      state.turnState = "READY_TO_ROLL";
    }

    const previousName =
      data.previous_player?.name || "The player";

    const currentName =
      data.current_player?.name ||
      state.currentPlayer?.name ||
      "the next player";

    state.message =
      `${previousName} rolled a Rollio and lost ` +
      `${data.lost_score ?? 0} points. ` +
      `It is now ${currentName}'s turn.`;

    return;
  }

  applyServerState(apiResponse.game);

  if (returnedDice) {
    placeRolledDiceInOpenSlots(returnedDice);
  }

  state.rollioActive = false;
  state.message = "Select the scoring dice you want to hold.";
}

export function handleDiceHeld(data, apiResponse) {
  applyServerState(apiResponse.game);

  for (const index of state.selectedIndexes) {
    state.heldIndexes.add(index);
  }

  state.displayedDice = [...state.rolledDice];
  state.selectedIndexes = new Set();
  state.selectionIsValid = false;
  state.selectedScore = 0;
  state.message = `Held for +${data.score}.`;
}

export function handleScoreBanked(data, apiResponse) {
  const previousName =
    data.previous_player?.name || "The player";

  const currentName =
    data.current_player?.name || "the next player";

  resetTurnModel();
  applyServerState(apiResponse.game);

  state.message =
    `${previousName} banked ${data.banked_score} points. ` +
    `It is now ${currentName}'s turn.`;
}

export function handleError(_data, apiResponse) {
  throw new Error(
    apiResponse.message || "The server rejected the request.",
  );
}