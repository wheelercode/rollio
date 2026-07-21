// ACTION REQUIRED

import { callApi, initializeApi } from "./http.js";
import { scoreSelection } from "./scoring.js";
import {
  dispatch,
  getOpenIndexes,
  getState,
  STATE_ACTION,
  UI_PHASE,
} from "./state.js";
import * as ui from "./ui.js";
import { delay, getPlayerById } from "./utils.js";
import {
  connectWebSocket,
  initializeWebSocket,
  sendCommand,
  isWebSocketConnected,
} from "./websockets.js";

let rollAnimationPromise = null;
let bankAnimationPromise = null;
let predictedBank = null;
let localPlayerId = null;

const apiResponseHandlers = Object.freeze({
  GAME_WAITING: handleGameWaiting,
  GAME_STARTED: handleGameStarted,
  ROLL_STARTED: handleRollStarted,
  DICE_SELECTION_CHANGED: handleDiceSelectionChanged,
  DICE_ROLLED: handleDiceRolled,
  SCORE_BANKED: handleScoreBanked,
  ERROR: handleError,
});

const ROLLIO_SLOT_DELAY = 300;
const ROLLIO_STAMP_DELAY = 150;
const ROLLIO_DISPLAY_DURATION = 3000;

function render() {
  ui.render(getState());
}

function getTurnState() {
  return getState().game?.turn?.state ?? null;
}

function getReturnedRolledDice(eventData, gameState) {
  const rolledDice = eventData.rollio
    ? eventData.rolled_dice
    : gameState?.turn?.rolled_dice;

  return Array.isArray(rolledDice) ? rolledDice : null;
}

function setMessage(message) {
  dispatch(STATE_ACTION.MESSAGE_SET, { message });
}

async function handleGameWaiting(eventData, apiResponse) {
  localPlayerId = eventData.player_id ?? localPlayerId;

  if (!localPlayerId) {
    throw new Error(
      "The server did not identify the waiting player.",
    );
  }

  ui.setLocalPlayerId(localPlayerId);
  ui.showMatchmakingStatus(
    "Waiting for another human player to join...",
  );

  await connectWebSocket({
    gameId: apiResponse.game_state?.game_id,
  });
}

async function handleGameStarted(eventData, apiResponse) {
  localPlayerId = eventData.player_id ?? localPlayerId;

  if (!localPlayerId) {
    throw new Error(
      "The server did not identify the local player.",
    );
  }

  ui.setLocalPlayerId(localPlayerId);
  ui.showMatchmakingStatus("");
  ui.closeGameTypeDialog();

  dispatch(STATE_ACTION.GAME_STARTED, {
    game: apiResponse.game_state,
  });

  const currentPlayer = getPlayerById(
    apiResponse.game_state,
    apiResponse.game_state?.current_player_id,
  );

  const playerName = currentPlayer?.name ?? "Player 1";
  const gameId = apiResponse.game_state?.game_id;

  if (!gameId) {
    throw new Error("The server started a game without returning a game ID.");
  }

  setMessage("Connecting to the game...");
  render();

  if (!isWebSocketConnected()) {
    await connectWebSocket({
      gameId,
    });
  }

  setMessage(`${playerName}, press Roll to begin.`);
}

function applySelectionState(selectedIndexes) {
  dispatch(STATE_ACTION.DICE_SELECTION_SYNCED, {
    selectedIndexes,
  });

  const selectedDice = ui.getSelectedDice(getState());
  const result = scoreSelection(selectedDice);
  const valid = selectedDice.length > 0 && result.valid;

  dispatch(STATE_ACTION.SELECTION_EVALUATED, {
    valid,
    score: result.score,
  });

  if (selectedDice.length === 0) {
    setMessage("");
  } else if (valid) {
    setMessage(
      result.groups
        .map((group) => group.label)
        .join(" • "),
    );
  } else {
    setMessage("Every selected die must be part of a scoring group.");
  }
}

function handleDiceSelectionChanged(eventData) {
  const selectedIndexes = Array.isArray(eventData.selected_indexes)
    ? eventData.selected_indexes
    : [];

  applySelectionState(selectedIndexes);
}

function handleRollStarted(eventData) {
  if (
    eventData.player_id === localPlayerId &&
    rollAnimationPromise
  ) {
    return;
  }

  const selectedIndexes = Array.isArray(eventData.selected_indexes)
    ? eventData.selected_indexes
    : [];

  dispatch(STATE_ACTION.ROLL_STARTED, {
    selectedIndexes,
    submittedScore: getState().ui.selectedScore,
  });

  const openIndexes = getOpenIndexes();
  render();
  rollAnimationPromise = ui.animateRoll(openIndexes);
}

async function handleDiceRolled(eventData, apiResponse) {
  if (rollAnimationPromise) {
    await rollAnimationPromise;
    rollAnimationPromise = null;
  }

  const rolledDice = getReturnedRolledDice(eventData, apiResponse.game_state);

  if (!rolledDice) {
    throw new Error("The server did not return rolled dice.");
  }

  const predictedSelectedScore = getState().ui.submittedScore;
  const serverSelectedScore = eventData.selected_score ?? 0;

  if (predictedSelectedScore !== serverSelectedScore) {
    console.warn(
      "Client/server selection score mismatch:",
      {
        predictedSelectedScore,
        serverSelectedScore,
        difference:
          serverSelectedScore - predictedSelectedScore,
      },
    );
  }

  const newlyRolledIndexes = getOpenIndexes();

  dispatch(STATE_ACTION.DICE_ROLLED, {
    game: apiResponse.game_state,
    rolledDice,
    rollio: Boolean(eventData.rollio),
  });

  render();
  await ui.showSettledBorders(newlyRolledIndexes);

  if (eventData.rollio) {
    const previousPlayer = getPlayerById(
      apiResponse.game_state,
      eventData.previous_player_id,
    );

    const currentPlayer = getPlayerById(
      apiResponse.game_state,
      apiResponse.game_state?.current_player_id,
    );

    const previousName = previousPlayer?.name ?? "The player";
    const currentName = currentPlayer?.name ?? "the next player";

    setMessage(
      `${previousName} rolled a Rollio and lost ` +
        `${eventData.lost_score ?? 0} points. ` +
        `It is now ${currentName}'s turn.`,
    );

    render();

    await delay(ROLLIO_SLOT_DELAY);

    dispatch(STATE_ACTION.ROLLIO_ACTIVATED);
    render();

    await delay(ROLLIO_STAMP_DELAY);

    dispatch(STATE_ACTION.ROLLIO_STAMP_SHOWN);
    render();

    await delay(ROLLIO_DISPLAY_DURATION);

    dispatch(STATE_ACTION.ROLLIO_CLEARED);

    setMessage(`${currentName}, press Roll to begin your turn.`);
    return;
  }

  setMessage("Select scoring dice, then Roll again or Bank.");
}

async function handleScoreBanked(eventData, apiResponse) {
  if (bankAnimationPromise) {
    await bankAnimationPromise;
    bankAnimationPromise = null;
  }

  const previousPlayer = getPlayerById(
    apiResponse.game_state,
    eventData.previous_player_id,
  );

  if (predictedBank && previousPlayer) {
    const authoritativePlayerScore = previousPlayer.score ?? 0;

    if (
      authoritativePlayerScore !==
      predictedBank.toPlayerScore
    ) {
      console.warn(
        "Client/server bank score mismatch:",
        {
          predictedPlayerScore:
            predictedBank.toPlayerScore,
          authoritativePlayerScore,
          difference:
            authoritativePlayerScore -
            predictedBank.toPlayerScore,
        },
      );
    }
  }

  predictedBank = null;

  dispatch(STATE_ACTION.SCORE_BANKED, {
    game: apiResponse.game_state,
  });

  const currentPlayer = getPlayerById(
    apiResponse.game_state,
    apiResponse.game_state?.current_player_id,
  );

  const previousName = previousPlayer?.name ?? "The player";
  const currentName = currentPlayer?.name ?? "the next player";

  if (eventData.game_over) {
    setMessage(
      `${previousName} banked ` +
        `${eventData.banked_score} points and won the game!`,
    );
    return;
  }

  setMessage(
    `${previousName} banked ` +
      `${eventData.banked_score} points. ` +
      `It is now ${currentName}'s turn.`,
  );
}

function handleError(_eventData, apiResponse) {
  throw new Error(apiResponse.message || "The server rejected the request.");
}

const API_PROTOCOL_VERSION = 1;

function validateApiResponse(apiResponse) {
  if (
    !apiResponse ||
    typeof apiResponse !== "object" ||
    Array.isArray(apiResponse)
  ) {
    throw new Error("The server returned an invalid response.");
  }

  if (apiResponse.protocol_version !== API_PROTOCOL_VERSION) {
    throw new Error("The server returned an unsupported protocol version.");
  }

  if (typeof apiResponse.message !== "string") {
    throw new Error("The server response has an invalid message.");
  }

  if (typeof apiResponse.game_event !== "string") {
    throw new Error("The server response has no valid game event.");
  }

  if (
    !apiResponse.event_data ||
    typeof apiResponse.event_data !== "object" ||
    Array.isArray(apiResponse.event_data)
  ) {
    throw new Error("The server response has invalid event data.");
  }

  if (
    !apiResponse.game_state ||
    typeof apiResponse.game_state !== "object" ||
    Array.isArray(apiResponse.game_state)
  ) {
    throw new Error("The server response has invalid game state.");
  }
}

async function handleApiResponse(apiResponse) {
  validateApiResponse(apiResponse);

  const handler = apiResponseHandlers[apiResponse.game_event];

  if (!handler) {
    throw new Error(`Unhandled game event: ${apiResponse.game_event}`);
  }

  await handler(apiResponse.event_data, apiResponse);

  render();
}

export function startGame() {
  const playerName = ui.readPlayerName().trim() || "Player 1";

  sessionStorage.setItem("rollioPlayerName", playerName);

  dispatch(STATE_ACTION.GAME_ROOM_ENTERED);
  render();
  ui.openGameTypeDialog();
}

export async function selectGameType(gameType) {
  if (!["single", "human", "ai"].includes(gameType)) {
    return;
  }

  const playerName =
    sessionStorage.getItem("rollioPlayerName") ||
    ui.readPlayerName().trim() ||
    "Player 1";

  try {
    const statusMessages = {
      single: "Starting single-player game...",
      human: "Looking for an available human game...",
      ai: "Starting a game against the computer...",
    };

    ui.showMatchmakingStatus(statusMessages[gameType]);

    await callApi("/game/start", {
      player_name: playerName,
      opponent_type: gameType,
    });
  } catch (error) {
    ui.showMatchmakingStatus("");

    dispatch(STATE_ACTION.REQUEST_FAILED, {
      message: error.message,
    });

    render();
  }
}

export async function roll() {
  const state = getState();

  if (
    state.ui.phase !== UI_PHASE.IDLE ||
    (
      localPlayerId !== null &&
      state.game?.current_player_id !== localPlayerId
    )
  ) {
    return;
  }

  const gameId = state.game?.game_id;
  const turnState = getTurnState();
  const scoringDice = ui.getSelectedDice(state);
  const selectedIndexes = [...state.ui.selectedIndexes];

  if (!gameId) {
    dispatch(STATE_ACTION.REQUEST_FAILED, {
      message: "No active game was found.",
    });

    render();
    return;
  }

  const firstRoll = turnState === "READY_TO_ROLL";

  const continuedRoll =
    turnState === "WAITING_FOR_SELECTION" &&
    state.ui.selectionIsValid &&
    scoringDice.length > 0;

  if (!firstRoll && !continuedRoll) {
    return;
  }

  dispatch(STATE_ACTION.ROLL_STARTED, {
    selectedIndexes,
    submittedScore: state.ui.selectedScore,
  });

  const openIndexes = getOpenIndexes();

  if (openIndexes.length === 0) {
    dispatch(STATE_ACTION.REQUEST_FAILED, {
      message: "No dice are available to roll.",
    });

    render();
    return;
  }

  render();

  rollAnimationPromise = ui.animateRoll(openIndexes);

  try {
    sendCommand(localPlayerId, "ROLL", {
      scoring_dice: scoringDice,
      selected_indexes: selectedIndexes,
    });
  } catch (error) {
    if (rollAnimationPromise) {
      await rollAnimationPromise;
      rollAnimationPromise = null;
    }

    dispatch(STATE_ACTION.REQUEST_FAILED, {
      message: error.message,
    });

    render();
  }
}

export async function bank() {
  const state = getState();
  const scoringDice = ui.getSelectedDice(state);

  if (
    state.ui.phase !== UI_PHASE.IDLE ||
    (
      localPlayerId !== null &&
      state.game?.current_player_id !== localPlayerId
    ) ||
    getTurnState() !== "WAITING_FOR_SELECTION" ||
    !state.ui.selectionIsValid ||
    scoringDice.length === 0
  ) {
    return;
  }

  const gameId = state.game?.game_id;

  if (!gameId) {
    dispatch(STATE_ACTION.REQUEST_FAILED, {
      message: "No active game was found.",
    });

    render();
    return;
  }

  const currentPlayer = getPlayerById(
    state.game,
    state.game?.current_player_id,
  );

  const authoritativeTurnScore =
    state.game?.turn?.base_score ?? 0;

  const bankedScore =
    authoritativeTurnScore +
    (state.ui.selectedScore ?? 0) +
    (state.ui.submittedScore ?? 0);

  const fromPlayerScore = currentPlayer?.score ?? 0;
  const toPlayerScore =
    fromPlayerScore + bankedScore;

  predictedBank = {
    bankedScore,
    fromPlayerScore,
    toPlayerScore,
    playerId: currentPlayer?.player_id ?? null,
  };

  dispatch(STATE_ACTION.BANK_STARTED);
  render();

  bankAnimationPromise = ui.animateBankTransfer(
    predictedBank,
  );

  try {
    sendCommand(localPlayerId, "BANK", {
      scoring_dice: scoringDice,
    });
  } catch (error) {
    if (bankAnimationPromise) {
      await bankAnimationPromise;
      bankAnimationPromise = null;
    }

    predictedBank = null;

    dispatch(STATE_ACTION.REQUEST_FAILED, {
      message: error.message,
    });

    render();
  }
}

export function toggleDieSelection(index) {
  const state = getState();
  const value = state.ui.trayValues[index];

  if (
    state.ui.phase !== UI_PHASE.IDLE ||
    (
      localPlayerId !== null &&
      state.game?.current_player_id !== localPlayerId
    ) ||
    getTurnState() !== "WAITING_FOR_SELECTION" ||
    value === null ||
    value === undefined ||
    state.ui.heldIndexes.has(index) ||
    state.ui.rollioActive
  ) {
    return;
  }

  const previousResult = scoreSelection(ui.getSelectedDice(getState()));
  const previousSelectionScore = previousResult.score;

  dispatch(STATE_ACTION.DIE_SELECTION_TOGGLED, { index });

  const selectedDice = ui.getSelectedDice(getState());
  const result = scoreSelection(selectedDice);
  const valid = selectedDice.length > 0 && result.valid;
  const nextSelectionScore = result.score;

  dispatch(STATE_ACTION.SELECTION_EVALUATED, {
    valid,
    score: result.score,
  });

  if (selectedDice.length === 0) {
    setMessage("");
  } else if (valid) {
    setMessage(
      result.groups
        .map((group) => group.label)
        .join(" • "),
    );
  } else {
    setMessage("Every selected die must be part of a scoring group.");
  }

  render();

  try {
    sendCommand(localPlayerId, "SELECT_DICE", {
      selected_indexes: [...getState().ui.selectedIndexes]
        .sort((left, right) => left - right),
    });
  } catch (error) {
    console.error("Could not synchronize dice selection:", error);
  }

  const scoreDifference =
    nextSelectionScore - previousSelectionScore;

  if (scoreDifference !== 0) {
    const authoritativeTurnScore =
      state.game?.turn?.base_score ?? 0;

    ui.animateScoringFeedback({
      fromScore:
        authoritativeTurnScore + previousSelectionScore,
      toScore:
        authoritativeTurnScore + nextSelectionScore,
      difference: scoreDifference,
      groups: result.groups,
    });
  }
}

export async function initialize() {
  dispatch(STATE_ACTION.RESET);

  ui.initialize({
    onStart: startGame,
    onGameTypeSelected: selectGameType,
    onRoll: roll,
    onBank: bank,
    onDieSelected: toggleDieSelection,
  });

  initializeApi(handleApiResponse);
  initializeWebSocket(handleApiResponse);
  render();

  try {
    await ui.preloadAssets();
    dispatch(STATE_ACTION.CLIENT_INITIALIZED);
  } catch (error) {
    dispatch(STATE_ACTION.REQUEST_FAILED, {
      message: `Could not load dice artwork: ` + error.message,
    });
  }

  render();
}
