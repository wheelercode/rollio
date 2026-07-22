import { scoreSelection } from "./scoring.js";

const SCORE_STEP = 50;
const TARGET_SCORE = 10_000;
const DICE_COUNT = 6;
const SOLUTION_URL = "./solver_data/solution.json";

let solution = null;
let loadError = null;
let lastStateKey = null;

function getOutputElement() {
  return document.getElementById("optimalPlayOutput");
}

function setOutput(message, tone = "neutral") {
  const output = getOutputElement();

  if (!output) {
    return;
  }

  output.textContent = message;
  output.dataset.tone = tone;
}

function scoreToUnits(score) {
  if (!Number.isInteger(score) || score < 0 || score % SCORE_STEP !== 0) {
    throw new Error("Solver scores must be nonnegative multiples of 50.");
  }

  return score / SCORE_STEP;
}

function normalizeTurnUnits(remainingUnits, turnUnits) {
  return Math.min(turnUnits, remainingUnits + 1);
}

function compareDice(left, right) {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return left.length - right.length;
}

function maximumRollScore(dice) {
  let bestScore = 0;
  const subsetCount = 1 << dice.length;

  for (let mask = 1; mask < subsetCount; mask += 1) {
    const subset = [];

    for (let index = 0; index < dice.length; index += 1) {
      if (mask & (1 << index)) {
        subset.push(dice[index]);
      }
    }

    const result = scoreSelection(subset);

    if (result.valid) {
      bestScore = Math.max(bestScore, result.score);
    }
  }

  return bestScore;
}

function legalSelections(rolledDice) {
  const selections = new Map();
  const subsetCount = 1 << rolledDice.length;

  for (let mask = 1; mask < subsetCount; mask += 1) {
    const selectedDice = [];
    const remainingDice = [];

    for (let index = 0; index < rolledDice.length; index += 1) {
      if (mask & (1 << index)) {
        selectedDice.push(rolledDice[index]);
      } else {
        remainingDice.push(rolledDice[index]);
      }
    }

    const result = scoreSelection(selectedDice);

    if (!result.valid) {
      continue;
    }

    selectedDice.sort((left, right) => left - right);
    const nextDice = remainingDice.length || DICE_COUNT;
    const exactFinishAllowed = maximumRollScore(remainingDice) === 0;
    const key = `${result.score}|${nextDice}|${exactFinishAllowed}`;
    const existing = selections.get(key);

    if (!existing || compareDice(selectedDice, existing.dice) < 0) {
      selections.set(key, {
        dice: selectedDice,
        score: result.score,
        nextDice,
        exactFinishAllowed,
      });
    }
  }

  return [...selections.values()];
}

function bankActionValue({
  remainingUnits,
  turnUnits,
  opened,
  exactFinishAllowed,
}) {
  if (turnUnits <= 0 || turnUnits > remainingUnits) {
    return Number.POSITIVE_INFINITY;
  }

  if (!opened && turnUnits < scoreToUnits(1_000)) {
    return Number.POSITIVE_INFINITY;
  }

  if (turnUnits === remainingUnits) {
    return exactFinishAllowed ? 1 : Number.POSITIVE_INFINITY;
  }

  return 1 + solution.start_values[remainingUnits - turnUnits];
}

function evaluateSelection({ totalScore, turnScore, selection }) {
  const remainingUnits = scoreToUnits(TARGET_SCORE - totalScore);
  const nextTurnScore = turnScore + selection.score;
  const nextTurnUnits = normalizeTurnUnits(
    remainingUnits,
    scoreToUnits(nextTurnScore),
  );
  const table = solution.values_by_remaining[remainingUnits];
  const rollValue = table[nextTurnUnits][selection.nextDice];
  const bankValue = bankActionValue({
    remainingUnits,
    turnUnits: nextTurnUnits,
    opened: totalScore > 0,
    exactFinishAllowed: selection.exactFinishAllowed,
  });
  const action = bankValue < rollValue ? "BANK" : "ROLL";

  return {
    ...selection,
    action,
    expectedActions: Math.min(rollValue, bankValue),
    nextTurnScore,
  };
}

function findCurrentPlayer(game) {
  return (
    game?.players?.find(
      (player) => player.player_id === game.current_player_id,
    ) ?? null
  );
}

function formatDice(dice) {
  return `[${dice.join(", ")}]`;
}

function analyzeState(state) {
  const game = state?.game;
  const turn = game?.turn;

  if (!game || !turn || !game.playing) {
    return "Waiting for an active game.";
  }

  const player = findCurrentPlayer(game);
  const totalScore = player?.score ?? 0;
  if (totalScore >= TARGET_SCORE) {
    return totalScore === TARGET_SCORE
      ? "Game complete: exact 10,000 reached."
      : `Invalid game state: score exceeded 10,000 (${totalScore}).`;
  }
  const turnScore = turn.base_score ?? 0;

  if (turn.state === "READY_TO_ROLL") {
    const remainingUnits = scoreToUnits(TARGET_SCORE - totalScore);
    const table = solution.values_by_remaining[remainingUnits];
    const expectedActions = table[scoreToUnits(turnScore)][DICE_COUNT];

    return `Optimal play: ROLL · ${expectedActions.toFixed(3)} expected Roll/Bank actions remain.`;
  }

  if (turn.state !== "WAITING_FOR_SELECTION") {
    return "Solver waiting for the next decision state.";
  }

  const rolledDice = Array.isArray(turn.rolled_dice) ? turn.rolled_dice : [];

  if (rolledDice.length === 0) {
    return "Solver waiting for rolled dice.";
  }

  const completeRoll = scoreSelection(rolledDice);

  if (
    turn.mandatory_hot_dice &&
    rolledDice.length === DICE_COUNT &&
    completeRoll.valid
  ) {
    return `Optimal play: select all ${formatDice(rolledDice)} and ROLL (mandatory hot dice).`;
  }

  const candidates = legalSelections(rolledDice)
    .map((selection) =>
      evaluateSelection({
        totalScore,
        turnScore,
        selection,
      }),
    )
    .sort((left, right) => {
      const valueDifference = left.expectedActions - right.expectedActions;

      if (Math.abs(valueDifference) > 1e-12) {
        return valueDifference;
      }

      return compareDice(left.dice, right.dice);
    });

  if (candidates.length === 0) {
    return "Rollio: no scoring selection is available.";
  }

  const best = candidates[0];
  const selectedDice = [...state.ui.selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => state.ui.trayValues[index])
    .filter((die) => Number.isInteger(die))
    .sort((left, right) => left - right);
  const selectedMatches =
    selectedDice.length > 0 && compareDice(selectedDice, best.dice) === 0;
  const matchText = selectedMatches ? " · current selection matches" : "";

  return (
    `Optimal play: select ${formatDice(best.dice)} for ${best.score}, ` +
    `then ${best.action} · turn score ${best.nextTurnScore} · ` +
    `${best.expectedActions.toFixed(3)} expected actions remain${matchText}.`
  );
}

function makeStateKey(state) {
  const game = state?.game;
  const turn = game?.turn;

  return JSON.stringify({
    gameId: game?.game_id ?? null,
    playing: game?.playing ?? false,
    currentPlayerId: game?.current_player_id ?? null,
    playerScores: game?.players?.map((player) => player.score) ?? [],
    turnState: turn?.state ?? null,
    turnScore: turn?.base_score ?? 0,
    rolledDice: turn?.rolled_dice ?? [],
    mandatoryHotDice: turn?.mandatory_hot_dice ?? false,
    selectedIndexes: [...(state?.ui?.selectedIndexes ?? [])].sort(
      (left, right) => left - right,
    ),
  });
}

async function loadSolution() {
  try {
    const response = await fetch(SOLUTION_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    solution = await response.json();

    if (
      !Array.isArray(solution.values_by_remaining) ||
      !Array.isArray(solution.start_values)
    ) {
      throw new Error("solver data has an invalid shape");
    }
  } catch (error) {
    loadError = error;
  }
}

export async function initializeOptimalPlayDebug(getState) {
  if (typeof getState !== "function") {
    throw new TypeError("initializeOptimalPlayDebug requires getState().");
  }

  setOutput("Loading optimal-play tables...");
  await loadSolution();

  if (loadError) {
    setOutput(
      `Solver data unavailable. Run: python export_solver_data.py (${loadError.message})`,
      "error",
    );
    return;
  }

  const refresh = () => {
    const state = getState();
    const stateKey = makeStateKey(state);

    if (stateKey === lastStateKey) {
      return;
    }

    lastStateKey = stateKey;

    try {
      setOutput(analyzeState(state), "ready");
    } catch (error) {
      console.error("Optimal-play debug output failed:", error);
      setOutput(`Solver error: ${error.message}`, "error");
    }
  };

  refresh();
  window.setInterval(refresh, 100);
}
