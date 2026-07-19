import { callApi, initializeApi } from "./api.js";
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

let rollAnimationPromise = null;

const apiResponseHandlers = Object.freeze({
  GAME_STARTED: handleGameStarted,
  DICE_ROLLED: handleDiceRolled,
  DICE_HELD: handleDiceHeld,
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

function getReturnedRolledDice(eventData = {}) {
  const turn =
    eventData.turn && typeof eventData.turn === "object" ? eventData.turn : {};
  const rolledDice = eventData.rolled_dice ?? turn.rolled_dice;
  return Array.isArray(rolledDice) ? rolledDice : null;
}

function setMessage(message) {
  dispatch(STATE_ACTION.MESSAGE_SET, { message });
}

function handleGameStarted(_eventData, apiResponse) {
  dispatch(STATE_ACTION.GAME_STARTED, { game: apiResponse.game });

  const playerName =
    apiResponse.game?.current_player?.name ??
    apiResponse.game?.turn?.player?.name ??
    "Player 1";

  setMessage(`${playerName}, press Roll to begin.`);
}

async function handleDiceRolled(eventData, apiResponse) {
  if (rollAnimationPromise) {
    await rollAnimationPromise;
    rollAnimationPromise = null;
  }

  const rolledDice = getReturnedRolledDice(eventData);

  if (!rolledDice) {
    throw new Error("The server did not return rolled dice.");
  }

  dispatch(STATE_ACTION.DICE_ROLLED, {
    game: apiResponse.game,
    rolledDice,
    rollio: Boolean(eventData.rollio),
  });

  if (eventData.rollio) {
    const previousName = eventData.previous_player?.name ?? "The player";

    const currentName =
      eventData.current_player?.name ??
      apiResponse.game?.current_player?.name ??
      "the next player";

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

  setMessage("Select the scoring dice you want to hold.");
}

function handleDiceHeld(eventData, apiResponse) {
  dispatch(STATE_ACTION.HOLD_CONFIRMED, { game: apiResponse.game });
  setMessage(`Held for +${eventData.score}.`);
}

function handleScoreBanked(eventData, apiResponse) {
  dispatch(STATE_ACTION.SCORE_BANKED, { game: apiResponse.game });

  const previousName = eventData.previous_player?.name ?? "The player";
  const currentName = eventData.current_player?.name ?? "the next player";

  setMessage(
    `${previousName} banked ${eventData.banked_score} points. ` +
      `It is now ${currentName}'s turn.`,
  );
}

function handleError(_eventData, apiResponse) {
  throw new Error(apiResponse.message || "The server rejected the request.");
}

async function handleApiResponse(apiResponse) {
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
        { name: playerName, type: "human" },
        { name: "Computer", type: "ai" },
      ],
    });
  } catch (error) {
    dispatch(STATE_ACTION.REQUEST_FAILED, { message: error.message });
    render();
  }
}

export async function roll() {
  const state = getState();

  if (state.ui.phase !== UI_PHASE.IDLE) return;

  dispatch(STATE_ACTION.ROLL_STARTED);

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
    await callApi("/game/roll", { n_dice: openIndexes.length });
  } catch (error) {
    if (rollAnimationPromise) {
      await rollAnimationPromise;
      rollAnimationPromise = null;
    }

    dispatch(STATE_ACTION.REQUEST_FAILED, { message: error.message });
    render();
  }
}

export async function hold() {
  const state = getState();
  const scoringDice = getSelectedDice();

  if (
    state.ui.phase !== UI_PHASE.IDLE ||
    !state.ui.selectionIsValid ||
    scoringDice.length === 0
  ) {
    return;
  }

  dispatch(STATE_ACTION.HOLD_STARTED);
  render();

  try {
    await callApi("/game/hold", { scoring_dice: scoringDice });
  } catch (error) {
    dispatch(STATE_ACTION.REQUEST_FAILED, { message: error.message });
    render();
  }
}

export async function bank() {
  if (getState().ui.phase !== UI_PHASE.IDLE) return;

  dispatch(STATE_ACTION.BANK_STARTED);
  render();

  try {
    await callApi("/game/bank");
  } catch (error) {
    dispatch(STATE_ACTION.REQUEST_FAILED, { message: error.message });
    render();
  }
}

export function toggleDieSelection(index) {
  const state = getState();
  const value = state.ui.trayValues[index];

  if (
    state.ui.phase !== UI_PHASE.IDLE ||
    !["WAITING_FOR_SELECTION", "READY_TO_CONTINUE"].includes(getTurnState()) ||
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

  if (selectedDice.length === 0) setMessage("");
  else if (valid) setMessage(`Valid selection: +${result.score}`);
  else setMessage("Every selected die must be part of a scoring group.");

  render();
}

export async function initialize() {
  dispatch(STATE_ACTION.RESET);

  ui.initialize({
    onStart: startGame,
    onRoll: roll,
    onHold: hold,
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
      message: `Could not load dice artwork: ${error.message}`,
    });
  }

  render();
}
