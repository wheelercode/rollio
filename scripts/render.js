import { state, UI_STATE } from "./state.js";
import { renderDiceTray } from "./dice-tray.js";

let elements = null;

export function initializeRenderer(domElements) {
  elements = domElements;
}

function requireElements() {
  if (!elements) {
    throw new Error("Renderer has not been initialized.");
  }
}

function getSelectedDice() {
  return [...state.selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => state.rolledDice[index])
    .filter((value) => value !== null && value !== undefined);
}

function renderScreens() {
  elements.startSection.hidden = state.activeScreen !== "start";
  elements.gameSection.hidden = state.activeScreen !== "game";
}

function renderScoreboard() {
  elements.playerNameDisplay.textContent =
    state.currentPlayer?.name ?? "Player 1";
  elements.playerScore.textContent = state.currentPlayer?.score ?? 0;
  elements.opponentScore.textContent = state.opponent?.score ?? 0;
  elements.targetScore.textContent = state.targetScore;
  elements.turnScore.textContent = state.turnScore;
  elements.rollNumber.textContent = state.rollNumber;
  elements.scoredDice.textContent =
    state.scoredDice.length > 0 ? state.scoredDice.join(", ") : "None";

  const selectedDice = getSelectedDice();
  elements.selectedDice.textContent =
    selectedDice.length > 0 ? selectedDice.join(", ") : "None";
}

function renderMessage() {
  elements.message.textContent = state.message;
}

function renderButtons() {
  const rolling = state.uiState === UI_STATE.ROLLING;
  let rollEnabled = false;
  let holdEnabled = false;
  let bankEnabled = false;

  if (state.initialized && state.gameStarted && !rolling) {
    if (state.turnState === "READY_TO_ROLL") {
      rollEnabled = true;
    } else if (state.turnState === "WAITING_FOR_SELECTION") {
      holdEnabled = state.selectionIsValid && !state.rollioActive;
    } else if (state.turnState === "READY_TO_CONTINUE") {
      rollEnabled = true;
      bankEnabled = true;
    }
  }

  elements.rollButton.disabled = !rollEnabled;
  elements.holdButton.disabled = !holdEnabled;
  elements.bankButton.disabled = !bankEnabled;
}

export function renderServerResponse() {
  requireElements();

  if (!state.serverResponse) {
    elements.output.textContent = "No request sent yet.";
    return;
  }

  elements.output.textContent = JSON.stringify(
    state.serverResponse,
    null,
    2,
  );
}

export function render() {
  requireElements();
  renderScreens();
  renderScoreboard();
  renderDiceTray();
  renderMessage();
  renderButtons();
  renderServerResponse();
}
