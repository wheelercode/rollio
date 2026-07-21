import assert from "node:assert/strict";
import test from "node:test";

import {
  dispatch,
  getState,
  STATE_ACTION,
} from "../scripts/state.js";
import { getGameControls } from "../scripts/ui.js";


function mandatoryGame() {
  return {
    game_id: "test-game",
    playing: true,
    current_player_id: "player-1",
    players: [
      {
        player_id: "player-1",
        name: "Player 1",
        score: 8500,
      },
    ],
    turn: {
      state: "WAITING_FOR_SELECTION",
      rolled_dice: [1, 2, 3, 4, 5, 6],
      scored_dice: [],
      base_score: 0,
      mandatory_hot_dice: true,
    },
  };
}

function loadMandatoryRoll() {
  const game = mandatoryGame();

  dispatch(STATE_ACTION.RESET);
  dispatch(STATE_ACTION.CLIENT_INITIALIZED);
  dispatch(STATE_ACTION.GAME_STARTED, { game });
  dispatch(STATE_ACTION.DICE_ROLLED, {
    game,
    rolledDice: game.turn.rolled_dice,
  });
}

test("mandatory hot dice force all six into the client selection", () => {
  loadMandatoryRoll();
  const state = getState();

  assert.deepEqual([...state.ui.selectedIndexes], [0, 1, 2, 3, 4, 5]);
  assert.equal(state.ui.selectionIsValid, true);
  assert.equal(state.ui.selectedScore, 1500);
  assert.equal(state.ui.message, "Hot dice—you must roll again.");
});

test("mandatory selection cannot be toggled or replaced", () => {
  loadMandatoryRoll();

  dispatch(STATE_ACTION.DIE_SELECTION_TOGGLED, { index: 0 });
  dispatch(STATE_ACTION.DICE_SELECTION_SYNCED, {
    selectedIndexes: [0, 4],
  });

  assert.deepEqual(
    [...getState().ui.selectedIndexes],
    [0, 1, 2, 3, 4, 5],
  );
});

test("mandatory hot dice enable only Roll and lock the dice", () => {
  loadMandatoryRoll();

  const controls = getGameControls(getState(), "player-1");

  assert.equal(controls.rollEnabled, true);
  assert.equal(controls.bankEnabled, false);
  assert.equal(controls.diceSelectable, false);
});

test("an authoritative error restores the forced selection", () => {
  loadMandatoryRoll();

  dispatch(STATE_ACTION.ROLL_STARTED, {
    selectedIndexes: [0, 1, 2, 3, 4, 5],
    submittedScore: 1500,
  });
  assert.equal(getState().ui.selectedIndexes.size, 0);

  const game = mandatoryGame();
  dispatch(STATE_ACTION.REQUEST_FAILED, {
    message: "You must select all six hot dice and roll again.",
    game,
  });

  assert.deepEqual([...getState().ui.selectedIndexes], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(getState().ui.trayValues, [1, 2, 3, 4, 5, 6]);
  assert.equal(getState().ui.selectedScore, 1500);
});
