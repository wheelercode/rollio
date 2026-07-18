import { state, UI_STATE } from "./state.js";
import { scoreSelection } from "./scoring.js";
import { callApi } from "./api.js";
import {
  animateRollingDice,
  getRollDiceCount,
} from "./dice-tray.js";
import { render } from "./render.js";

let getPlayerName = null;

export function initializeActions({ playerName } = {}) {
  if (typeof playerName !== "function") {
    throw new TypeError("initializeActions requires a playerName function.");
  }

  getPlayerName = playerName;
}

function getSelectedDice() {
  return [...state.selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => state.rolledDice[index])
    .filter((value) => value !== null && value !== undefined);
}

function validateSelection() {
  const selectedDice = getSelectedDice();
  const result = scoreSelection(selectedDice);

  state.selectionIsValid = selectedDice.length > 0 && result.valid;
  state.selectedScore = result.score;

  if (selectedDice.length === 0) state.message = "";
  else if (result.valid) state.message = `Valid selection: +${result.score}`;
  else state.message = "Every selected die must be part of a scoring group.";
}

export function toggleDieSelectionState(index) {
  if (
    state.uiState === UI_STATE.ROLLING ||
    state.turnState !== "WAITING_FOR_SELECTION" ||
    state.rolledDice[index] === null ||
    state.rolledDice[index] === undefined ||
    state.heldIndexes.has(index) ||
    state.rollioActive
  ) {
    return;
  }

  const nextSelection = new Set(state.selectedIndexes);
  if (nextSelection.has(index)) nextSelection.delete(index);
  else nextSelection.add(index);

  state.selectedIndexes = nextSelection;
  validateSelection();
  render();
}

export async function startGame() {
  if (!getPlayerName) {
    throw new Error("Actions module has not been initialized.");
  }

  state.message = "";
  render();

  try {
    const playerName = getPlayerName().trim() || "Player 1";

    await callApi("/game/start", {
      players: [
        { name: playerName, type: "human" },
        { name: "Computer", type: "ai" },
      ],
    });
  } catch (error) {
    state.message = error.message;
  }

  render();
}

export async function roll() {
  if (state.uiState === UI_STATE.ROLLING) return;

  if (state.rollioActive) {
    state.rollioActive = false;
    state.heldIndexes = new Set();
    state.selectedIndexes = new Set();
    state.selectionIsValid = false;
    state.selectedScore = 0;
    state.scoredDice = [];
  }

  const numberOfDice = getRollDiceCount();
  if (numberOfDice === 0) return;

  state.uiState = UI_STATE.ROLLING;
  state.message = "Rolling...";
  state.selectedIndexes = new Set();
  state.selectionIsValid = false;
  state.selectedScore = 0;
  state.rollAnimationPromise = animateRollingDice();
  render();

  try {
    await callApi("/game/roll", { n_dice: numberOfDice });
  } catch (error) {
    state.message = error.message;
    state.displayedDice = [...state.rolledDice];
  } finally {
    state.rollAnimationPromise = null;
    state.uiState = UI_STATE.READY;
  }

  render();
}

export async function hold() {
  const scoringDice = getSelectedDice();
  if (!state.selectionIsValid || scoringDice.length === 0) return;

  state.message = "";
  render();

  try {
    await callApi("/game/hold", { scoring_dice: scoringDice });
  } catch (error) {
    state.message = error.message;
  }

  render();
}

export async function bank() {
  state.message = "";
  render();

  try {
    await callApi("/game/bank");
  } catch (error) {
    state.message = error.message;
  }

  render();
}
