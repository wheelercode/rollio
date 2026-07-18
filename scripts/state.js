export const UI_STATE = Object.freeze({
  READY: "READY",
  ROLLING: "ROLLING",
});

export const state = {
  initialized: false,
  gameStarted: false,
  activeScreen: "start",

  uiState: UI_STATE.READY,

  players: [],
  currentPlayer: null,
  opponent: null,
  targetScore: 0,

  turnState: null,
  turnScore: 0,
  rollNumber: 0,

  rolledDice: Array(6).fill(null),
  displayedDice: Array(6).fill(null),
  scoredDice: [],

  heldIndexes: new Set(),
  selectedIndexes: new Set(),
  selectionIsValid: false,
  selectedScore: 0,

  rollioActive: false,
  rollAnimationPromise: null,

  message: "",
  serverResponse: null,
};
