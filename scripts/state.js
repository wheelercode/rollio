// ACTION REQUIRED

export const SCREEN = Object.freeze({
  WELCOME: "WELCOME",
  PLAY: "PLAY",
  RECAP: "RECAP",
});

export const UI_PHASE = Object.freeze({
  IDLE: "IDLE",
  ROLLING: "ROLLING",
  SUBMITTING: "SUBMITTING",
});

export const STATE_ACTION = Object.freeze({
  RESET: "RESET",
  CLIENT_INITIALIZED: "CLIENT_INITIALIZED",
  API_RESPONSE_RECEIVED: "API_RESPONSE_RECEIVED",
  GAME_ROOM_ENTERED: "GAME_ROOM_ENTERED",
  GAME_STARTED: "GAME_STARTED",
  ROLL_STARTED: "ROLL_STARTED",
  DICE_ROLLED: "DICE_ROLLED",
  DIE_SELECTION_TOGGLED: "DIE_SELECTION_TOGGLED",
  SELECTION_EVALUATED: "SELECTION_EVALUATED",
  BANK_STARTED: "BANK_STARTED",
  SCORE_BANKED: "SCORE_BANKED",
  REQUEST_FAILED: "REQUEST_FAILED",
  MESSAGE_SET: "MESSAGE_SET",
  ROLLIO_ACTIVATED: "ROLLIO_ACTIVATED",
  ROLLIO_STAMP_SHOWN: "ROLLIO_STAMP_SHOWN",
  ROLLIO_CLEARED: "ROLLIO_CLEARED",
});

const DICE_COUNT = 6;

function createInitialState() {
  return {
    game: null,

    ui: {
      initialized: false,
      screen: SCREEN.WELCOME,
      phase: UI_PHASE.IDLE,
      trayValues: Array(DICE_COUNT).fill(null),
      heldIndexes: new Set(),
      selectedIndexes: new Set(),
      selectionIsValid: false,
      selectedScore: 0,
      submittedScore: 0,
      rollioActive: false,
      rollioStampVisible: false,
      hotDiceActive: false,
      message: "",
      lastApiResponse: null,
    },
  };
}

const state = createInitialState();

function replaceState(nextState) {
  for (const key of Object.keys(state)) {
    delete state[key];
  }

  Object.assign(state, nextState);
}

function clearSelection() {
  state.ui.selectedIndexes = new Set();
  state.ui.selectionIsValid = false;
  state.ui.selectedScore = 0;
}

function resetTray() {
  state.ui.trayValues = Array(DICE_COUNT).fill(null);
  state.ui.heldIndexes = new Set();
  state.ui.rollioActive = false;
  state.ui.rollioStampVisible = false;
  state.ui.hotDiceActive = false;
  state.ui.submittedScore = 0;

  clearSelection();
}

function getOpenTrayIndexes() {
  const indexes = [];

  for (let index = 0; index < DICE_COUNT; index += 1) {
    if (!state.ui.heldIndexes.has(index)) {
      indexes.push(index);
    }
  }

  return indexes;
}

function placeDiceInOpenSlots(rolledDice) {
  const openIndexes = getOpenTrayIndexes();

  if (rolledDice.length !== openIndexes.length) {
    throw new Error(
      `Server returned ${rolledDice.length} dice, ` +
        `but ${openIndexes.length} tray slots are available.`,
    );
  }

  const nextTrayValues = [...state.ui.trayValues];

  for (
    let offset = 0;
    offset < openIndexes.length;
    offset += 1
  ) {
    nextTrayValues[openIndexes[offset]] =
      rolledDice[offset];
  }

  state.ui.trayValues = nextTrayValues;
}

function handleReset() {
  replaceState(createInitialState());
}

function handleClientInitialized() {
  state.ui.initialized = true;
}

function handleApiResponseReceived({ apiResponse }) {
  state.ui.lastApiResponse = apiResponse;
}

function handleGameRoomEntered() {
  state.ui.screen = SCREEN.PLAY;
  state.ui.phase = UI_PHASE.IDLE;
  state.ui.message = "Select a game type to begin.";
}

function handleGameStarted({ game }) {
  state.game = game;
  state.ui.screen = SCREEN.PLAY;
  state.ui.phase = UI_PHASE.IDLE;

  resetTray();
}

function handleRollStarted({
  selectedIndexes = [],
  submittedScore = 0,
} = {}) {
  state.ui.phase = UI_PHASE.ROLLING;
  state.ui.message = "Rolling...";
  state.ui.submittedScore = submittedScore;

  if (state.ui.rollioActive) {
    resetTray();
  }

  for (const index of selectedIndexes) {
    state.ui.heldIndexes.add(index);
  }

  state.ui.hotDiceActive =
    state.ui.heldIndexes.size === DICE_COUNT;

  clearSelection();

  if (state.ui.hotDiceActive) {
    state.ui.trayValues =
      Array(DICE_COUNT).fill(null);

    state.ui.heldIndexes = new Set();
  }
}

function handleDiceRolled({
  game,
  rolledDice,
  rollio = false,
}) {
  state.game = game;

  placeDiceInOpenSlots(rolledDice);

  state.ui.phase = rollio
    ? UI_PHASE.SUBMITTING
    : UI_PHASE.IDLE;

  state.ui.submittedScore = 0;
  state.ui.rollioActive = false;
  state.ui.rollioStampVisible = false;
  state.ui.hotDiceActive = false;

  clearSelection();
}

function handleDieSelectionToggled({ index }) {
  const nextSelection = new Set(
    state.ui.selectedIndexes,
  );

  if (nextSelection.has(index)) {
    nextSelection.delete(index);
  } else {
    nextSelection.add(index);
  }

  state.ui.selectedIndexes = nextSelection;
}

function handleSelectionEvaluated({
  valid,
  score,
}) {
  state.ui.selectionIsValid = Boolean(valid);
  state.ui.selectedScore = score ?? 0;
}

function handleBankStarted() {
  state.ui.phase = UI_PHASE.SUBMITTING;
  state.ui.message = "";
}

function handleScoreBanked({ game }) {
  state.game = game;
  state.ui.phase = UI_PHASE.IDLE;

  resetTray();
}

function handleRequestFailed({ message }) {
  state.ui.phase = UI_PHASE.IDLE;
  state.ui.submittedScore = 0;
  state.ui.message = message ?? "Request failed.";
}

function handleMessageSet({ message = "" }) {
  state.ui.message = message;
}

function handleRollioActivated() {
  state.ui.rollioActive = true;
}

function handleRollioStampShown() {
  state.ui.rollioStampVisible = true;
}

function handleRollioCleared() {
  resetTray();
  state.ui.phase = UI_PHASE.IDLE;
}

const stateActionHandlers = Object.freeze({
  [STATE_ACTION.RESET]:
    handleReset,

  [STATE_ACTION.CLIENT_INITIALIZED]:
    handleClientInitialized,

  [STATE_ACTION.API_RESPONSE_RECEIVED]:
    handleApiResponseReceived,

  [STATE_ACTION.GAME_ROOM_ENTERED]:
    handleGameRoomEntered,

  [STATE_ACTION.GAME_STARTED]:
    handleGameStarted,

  [STATE_ACTION.ROLL_STARTED]:
    handleRollStarted,

  [STATE_ACTION.DICE_ROLLED]:
    handleDiceRolled,

  [STATE_ACTION.DIE_SELECTION_TOGGLED]:
    handleDieSelectionToggled,

  [STATE_ACTION.SELECTION_EVALUATED]:
    handleSelectionEvaluated,

  [STATE_ACTION.BANK_STARTED]:
    handleBankStarted,

  [STATE_ACTION.SCORE_BANKED]:
    handleScoreBanked,

  [STATE_ACTION.REQUEST_FAILED]:
    handleRequestFailed,

  [STATE_ACTION.MESSAGE_SET]:
    handleMessageSet,

  [STATE_ACTION.ROLLIO_ACTIVATED]:
    handleRollioActivated,

  [STATE_ACTION.ROLLIO_STAMP_SHOWN]:
    handleRollioStampShown,

  [STATE_ACTION.ROLLIO_CLEARED]:
    handleRollioCleared,
});

export function dispatch(type, payload = {}) {
  const handler = stateActionHandlers[type];

  if (!handler) {
    throw new Error(
      `Unknown state action: ${type}`,
    );
  }

  handler(payload);
}

export function getState() {
  return state;
}

export function getOpenIndexes() {
  return getOpenTrayIndexes();
}

export function getSelectedDice() {
  return [...state.ui.selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => state.ui.trayValues[index])
    .filter(
      (value) =>
        value !== null &&
        value !== undefined,
    );
}
