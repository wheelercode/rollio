import { state } from "./state.js";
import { initializeApi } from "./api.js";
import {
  bank,
  hold,
  initializeActions,
  roll,
  startGame,
  toggleDieSelectionState,
} from "./game-actions.js";
import {
  handleDiceHeld,
  handleDiceRolled,
  handleError,
  handleGameStarted,
  handleScoreBanked,
} from "./api-response-handlers.js";
import {
  initializeDiceTray,
  preloadDiceFaces,
} from "./dice-tray.js";
import {
  initializeRenderer,
  render,
} from "./render.js";

const elements = {
  playerName: document.getElementById("playerName"),
  startButton: document.getElementById("startButton"),
  startSection: document.getElementById("startSection"),
  gameSection: document.getElementById("gameSection"),
  playerNameDisplay: document.getElementById("playerNameDisplay"),
  playerScore: document.getElementById("playerScore"),
  opponentScore: document.getElementById("opponentScore"),
  targetScore: document.getElementById("targetScore"),
  turnScore: document.getElementById("turnScore"),
  rollNumber: document.getElementById("rollNumber"),
  scoredDice: document.getElementById("scoredDice"),
  selectedDice: document.getElementById("selectedDice"),
  message: document.getElementById("message"),
  rollButton: document.getElementById("rollButton"),
  holdButton: document.getElementById("holdButton"),
  bankButton: document.getElementById("bankButton"),
  output: document.getElementById("output"),
  rolledDice: document.getElementById("rolledDice"),
};

const apiResponseHandlers = Object.freeze({
  GAME_STARTED: handleGameStarted,
  DICE_ROLLED: handleDiceRolled,
  DICE_HELD: handleDiceHeld,
  SCORE_BANKED: handleScoreBanked,
  ERROR: handleError,
});

async function apiResponseHandler(apiResponse) {
  state.serverResponse = apiResponse;

  const handler = apiResponseHandlers[apiResponse.game_event];

  if (!handler) {
    throw new Error(`Unhandled game event: ${apiResponse.game_event}`);
  }

  await handler(apiResponse.event_data, apiResponse);
}

initializeRenderer(elements);
initializeDiceTray(elements.rolledDice, toggleDieSelectionState);
initializeApi(apiResponseHandler);
initializeActions({
  playerName: () => elements.playerName.value,
});

elements.startButton.addEventListener("click", startGame);
elements.rollButton.addEventListener("click", roll);
elements.holdButton.addEventListener("click", hold);
elements.bankButton.addEventListener("click", bank);

async function initializeGameClient() {
  render();

  try {
    await preloadDiceFaces();
    state.initialized = true;
  } catch (error) {
    state.message = "Could not load dice artwork: " + error.message;
  }

  render();
}

initializeGameClient();