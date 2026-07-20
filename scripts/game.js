import { callApi, initializeApi } from "./http.js";
import { scoreSelection } from "./scoring.js";
import {
  dispatch,
  getOpenIndexes,
  getSelectedDice,
  getState,
  STATE_ACTION,
  UI_PHASE,
} from "./state.js";
import * as ui from "./ui.js";
import { delay, getPlayerById } from "./utils.js";

let rollAnimationPromise = null;

const apiResponseHandlers = Object.freeze({
  GAME_STARTED: handleGameStarted,
  DICE_ROLLED: handleDiceRolled,
  SCORE_BANKED: handleScoreBanked,
  ERROR: handleError,
});

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

function handleGameStarted(_eventData, apiResponse) {
  dispatch(STATE_ACTION.GAME_STARTED, {
    game: apiResponse.game_state,
  });

  const currentPlayer = getPlayerById(
    apiResponse.game_state,
    apiResponse.game_state?.current_player_id,
  );

  const playerName = currentPlayer?.name ?? "Player 1";

  setMessage(`${playerName}, press Roll to begin.`);
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

  dispatch(STATE_ACTION.DICE_ROLLED, {
    game: apiResponse.game_state,
    rolledDice,
    rollio: Boolean(eventData.rollio),
  });

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

    await delay(ROLLIO_DISPLAY_DURATION);

    dispatch(STATE_ACTION.ROLLIO_CLEARED);

    setMessage(`${currentName}, press Roll to begin your turn.`);

    return;
  }

  setMessage("Select scoring dice, then Roll again or Bank.");
}

function handleScoreBanked(eventData, apiResponse) {
  dispatch(STATE_ACTION.SCORE_BANKED, {
    game: apiResponse.game_state,
  });

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

  dispatch(STATE_ACTION.API_RESPONSE_RECEIVED, { apiResponse });

  const handler = apiResponseHandlers[apiResponse.game_event];

  if (!handler) {
    throw new Error(`Unhandled game event: ${apiResponse.game_event}`);
  }

  await handler(apiResponse.event_data, apiResponse);

  render();
}

export async function startGame() {
  setMessage("");
  render();

  try {
    const playerName = ui.readPlayerName().trim() || "Player 1";

    await callApi("/game/start", {
      players: [
        {
          name: playerName,
          type: "human",
        },
        {
          name: "Computer",
          type: "ai",
        },
      ],
    });
  } catch (error) {
    dispatch(STATE_ACTION.REQUEST_FAILED, {
      message: error.message,
    });

    render();
  }
}

export async function roll() {
  const state = getState();

  if (state.ui.phase !== UI_PHASE.IDLE) {
    return;
  }

  const gameId = state.game?.game_id;
  const turnState = getTurnState();
  const scoringDice = getSelectedDice();
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
    await callApi("/game/roll", {
      game_id: gameId,
      scoring_dice: scoringDice,
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
  const scoringDice = getSelectedDice();

  if (
    state.ui.phase !== UI_PHASE.IDLE ||
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

  dispatch(STATE_ACTION.BANK_STARTED);
  render();

  try {
    await callApi("/game/bank", {
      game_id: gameId,
      scoring_dice: scoringDice,
    });
  } catch (error) {
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
    !["WAITING_FOR_SELECTION"].includes(getTurnState()) ||
    value === null ||
    value === undefined ||
    state.ui.heldIndexes.has(index) ||
    state.ui.rollioActive
  ) {
    return;
  }

  dispatch(STATE_ACTION.DIE_SELECTION_TOGGLED, { index });

  const selectedDice = getSelectedDice();
  const result = scoreSelection(selectedDice);

  const valid = selectedDice.length > 0 && result.valid;

  dispatch(STATE_ACTION.SELECTION_EVALUATED, {
    valid,
    score: result.score,
  });

  if (selectedDice.length === 0) {
    setMessage("");
  } else if (valid) {
    setMessage(`Valid selection: +${result.score}`);
  } else {
    setMessage("Every selected die must be part of a scoring group.");
  }

  render();
}

export async function initialize() {
  dispatch(STATE_ACTION.RESET);

  ui.initialize({
    onStart: startGame,
    onRoll: roll,
    onBank: bank,
    onDieSelected: toggleDieSelection,
  });

  initializeApi(handleApiResponse);

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
