/**
 * Rollio client-side scoring preview.
 *
 * This file contains:
 *
 * 1. scoreGroup(dice)
 *    A direct JavaScript translation of the current Python Game.score() method.
 *    It scores one exact, indivisible scoring group and returns 0 when the
 *    entire array is not one recognized group.
 *
 * 2. scoreSelection(dice)
 *    Scores a complete user selection that may contain multiple scoring groups.
 *    It returns the maximum score and reports whether every selected die can be
 *    consumed by valid scoring groups.
 *
 * The server remains authoritative. This module is only for immediate UI
 * feedback and enabling/disabling the Roll and Bank buttons.
 */

/**
 * Validate and normalize an incoming dice array.
 *
 * @param {unknown} dice
 * @returns {number[]}
 * @throws {TypeError|RangeError}
 */
function normalizeDice(dice) {
  if (!Array.isArray(dice)) {
    throw new TypeError("dice must be an array");
  }

  return dice.map((die) => {
    if (!Number.isInteger(die)) {
      throw new TypeError("every die must be an integer");
    }

    if (die < 1 || die > 6) {
      throw new RangeError("every die must be between 1 and 6");
    }

    return die;
  });
}

/**
 * Build a frequency map for dice values.
 *
 * @param {number[]} dice
 * @returns {Map<number, number>}
 */
function countDice(dice) {
  const counts = new Map();

  for (const die of dice) {
    counts.set(die, (counts.get(die) || 0) + 1);
  }

  return counts;
}

/**
 * Compare two number arrays for exact equality.
 *
 * @param {number[]} left
 * @param {number[]} right
 * @returns {boolean}
 */
function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Score one exact, indivisible scoring group.
 *
 * This is a direct translation of the current Python Game.score() function.
 *
 * @param {number[]} dice
 * @returns {number}
 */
export function scoreGroup(dice) {
  const sortedDice = normalizeDice(dice).slice().sort((a, b) => a - b);
  const numberOfDice = sortedDice.length;
  const counts = countDice(sortedDice);
  const frequencyPattern = [...counts.values()].sort((a, b) => b - a);

  // Two sets of three
  if (
    numberOfDice === 6 &&
    arraysEqual(frequencyPattern, [3, 3])
  ) {
    return 2500;
  }

  // Four of a kind plus a pair
  if (
    numberOfDice === 6 &&
    arraysEqual(frequencyPattern, [4, 2])
  ) {
    return 1500;
  }

  // Three pairs
  if (
    numberOfDice === 6 &&
    arraysEqual(frequencyPattern, [2, 2, 2])
  ) {
    return 1500;
  }

  // Straight
  if (arraysEqual(sortedDice, [1, 2, 3, 4, 5, 6])) {
    return 1500;
  }

  // Three, four, five, or six of a kind
  if (
    [3, 4, 5, 6].includes(numberOfDice) &&
    counts.size === 1
  ) {
    const dieValue = sortedDice[0];
    const threeOfAKindScore =
      dieValue === 1
        ? 1000
        : dieValue * 100;

    const multiplier = 2 ** (numberOfDice - 3);

    return threeOfAKindScore * multiplier;
  }

  // Individual scoring dice
  if (arraysEqual(sortedDice, [1])) {
    return 100;
  }

  if (arraysEqual(sortedDice, [5])) {
    return 50;
  }

  return 0;
}

/**
 * Return all valid scoring groups that can be removed from the supplied dice.
 *
 * Groups are represented as arrays of die values. Duplicate logical groups are
 * removed so the recursive evaluator does not repeat identical work.
 *
 * @param {number[]} dice
 * @returns {number[][]}
 */
function findAvailableScoringGroups(dice) {
  const sortedDice = dice.slice().sort((a, b) => a - b);
  const counts = countDice(sortedDice);
  const groups = [];
  const seen = new Set();

  function addGroup(group) {
    const normalized = group.slice().sort((a, b) => a - b);
    const key = normalized.join(",");

    if (!seen.has(key) && scoreGroup(normalized) > 0) {
      seen.add(key);
      groups.push(normalized);
    }
  }

  // Six-die special groups.
  if (sortedDice.length === 6) {
    addGroup(sortedDice);
  }

  // Same-value groups of three through six.
  for (let dieValue = 1; dieValue <= 6; dieValue += 1) {
    const count = counts.get(dieValue) || 0;
    const maximumGroupSize = Math.min(count, 6);

    for (let size = 3; size <= maximumGroupSize; size += 1) {
      addGroup(Array(size).fill(dieValue));
    }
  }

  // Individual ones and fives.
  if ((counts.get(1) || 0) > 0) {
    addGroup([1]);
  }

  if ((counts.get(5) || 0) > 0) {
    addGroup([5]);
  }

  return groups;
}

/**
 * Remove one occurrence of every die in a scoring group.
 *
 * @param {number[]} dice
 * @param {number[]} group
 * @returns {number[]|null}
 */
function removeGroup(dice, group) {
  const remaining = dice.slice();

  for (const die of group) {
    const index = remaining.indexOf(die);

    if (index === -1) {
      return null;
    }

    remaining.splice(index, 1);
  }

  return remaining;
}

/**
 * Find the maximum score obtainable from the supplied dice while also tracking
 * how many dice were consumed by scoring groups.
 *
 * @param {number[]} dice
 * @param {Map<string, {score: number, usedDice: number}>} memo
 * @returns {{score: number, usedDice: number}}
 */
function evaluateSelection(dice, memo) {
  const sortedDice = dice.slice().sort((a, b) => a - b);
  const key = sortedDice.join(",");

  if (memo.has(key)) {
    return memo.get(key);
  }

  let best = {
    score: 0,
    usedDice: 0
  };

  const groups = findAvailableScoringGroups(sortedDice);

  for (const group of groups) {
    const remaining = removeGroup(sortedDice, group);

    if (remaining === null) {
      continue;
    }

    const remainderResult = evaluateSelection(remaining, memo);
    const candidate = {
      score: scoreGroup(group) + remainderResult.score,
      usedDice: group.length + remainderResult.usedDice
    };

    if (
      candidate.usedDice > best.usedDice ||
      (
        candidate.usedDice === best.usedDice &&
        candidate.score > best.score
      )
    ) {
      best = candidate;
    }
  }

  memo.set(key, best);
  return best;
}

/**
 * Score a complete user selection.
 *
 * The result is intended for immediate client UI feedback.
 *
 * @param {number[]} dice
 * @returns {{
 *   score: number,
 *   valid: boolean,
 *   allScoring: boolean,
 *   selectedDiceCount: number,
 *   scoringDiceCount: number
 * }}
 */
export function scoreSelection(dice) {
  const normalizedDice = normalizeDice(dice);

  if (normalizedDice.length === 0) {
    return {
      score: 0,
      valid: false,
      allScoring: false,
      selectedDiceCount: 0,
      scoringDiceCount: 0
    };
  }

  const result = evaluateSelection(normalizedDice, new Map());
  const allScoring = result.usedDice === normalizedDice.length;

  return {
    score: result.score,
    valid: allScoring && result.score > 0,
    allScoring,
    selectedDiceCount: normalizedDice.length,
    scoringDiceCount: result.usedDice
  };
}