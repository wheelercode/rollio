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

function countDice(dice) {
  const counts = new Map();

  for (const die of dice) {
    counts.set(die, (counts.get(die) || 0) + 1);
  }

  return counts;
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function scoreGroup(dice) {
  const sortedDice = normalizeDice(dice).slice().sort((a, b) => a - b);
  const numberOfDice = sortedDice.length;
  const counts = countDice(sortedDice);
  const frequencyPattern = [...counts.values()].sort((a, b) => b - a);

  if (
    numberOfDice === 6 &&
    arraysEqual(frequencyPattern, [3, 3])
  ) {
    return 2500;
  }

  if (
    numberOfDice === 6 &&
    arraysEqual(frequencyPattern, [4, 2])
  ) {
    return 1500;
  }

  if (
    numberOfDice === 6 &&
    arraysEqual(frequencyPattern, [2, 2, 2])
  ) {
    return 1500;
  }

  if (arraysEqual(sortedDice, [1, 2, 3, 4, 5, 6])) {
    return 1500;
  }

  if (
    [3, 4, 5, 6].includes(numberOfDice) &&
    counts.size === 1
  ) {
    const dieValue = sortedDice[0];
    const threeOfAKindScore =
      dieValue === 1 ? 1000 : dieValue * 100;

    return threeOfAKindScore * 2 ** (numberOfDice - 3);
  }

  if (arraysEqual(sortedDice, [1])) {
    return 100;
  }

  if (arraysEqual(sortedDice, [5])) {
    return 50;
  }

  return 0;
}

function describeScoringGroup(dice) {
  const sortedDice = dice.slice().sort((a, b) => a - b);
  const score = scoreGroup(sortedDice);
  const counts = countDice(sortedDice);
  const frequencyPattern = [...counts.values()].sort((a, b) => b - a);

  if (
    sortedDice.length === 6 &&
    arraysEqual(frequencyPattern, [3, 3])
  ) {
    return {
      dice: sortedDice,
      score,
      type: "TWO_TRIPLETS",
      label: "Two sets of three!",
      tone: "combination",
    };
  }

  if (
    sortedDice.length === 6 &&
    arraysEqual(frequencyPattern, [4, 2])
  ) {
    return {
      dice: sortedDice,
      score,
      type: "FOUR_AND_PAIR",
      label: "Four of a kind plus a pair!",
      tone: "combination",
    };
  }

  if (
    sortedDice.length === 6 &&
    arraysEqual(frequencyPattern, [2, 2, 2])
  ) {
    return {
      dice: sortedDice,
      score,
      type: "THREE_PAIRS",
      label: "Three pairs!",
      tone: "combination",
    };
  }

  if (arraysEqual(sortedDice, [1, 2, 3, 4, 5, 6])) {
    return {
      dice: sortedDice,
      score,
      type: "STRAIGHT",
      label: "Straight!",
      tone: "straight",
    };
  }

  if (
    [3, 4, 5, 6].includes(sortedDice.length) &&
    counts.size === 1
  ) {
    const words = {
      3: "Three",
      4: "Four",
      5: "Five",
      6: "Six",
    };

    return {
      dice: sortedDice,
      score,
      type: `${sortedDice.length}_OF_A_KIND`,
      label: `${words[sortedDice.length]} of a kind!`,
      tone: "kind",
    };
  }

  const dieValue = sortedDice[0];

  return {
    dice: sortedDice,
    score,
    type: dieValue === 1 ? "SINGLE_ONE" : "SINGLE_FIVE",
    label: dieValue === 1 ? "Single 1" : "Single 5",
    tone: "single",
  };
}

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

  if (sortedDice.length === 6) {
    addGroup(sortedDice);
  }

  for (let dieValue = 1; dieValue <= 6; dieValue += 1) {
    const count = counts.get(dieValue) || 0;
    const maximumGroupSize = Math.min(count, 6);

    for (let size = 3; size <= maximumGroupSize; size += 1) {
      addGroup(Array(size).fill(dieValue));
    }
  }

  if ((counts.get(1) || 0) > 0) {
    addGroup([1]);
  }

  if ((counts.get(5) || 0) > 0) {
    addGroup([5]);
  }

  return groups;
}

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

function evaluateSelection(dice, memo) {
  const sortedDice = dice.slice().sort((a, b) => a - b);
  const key = sortedDice.join(",");

  if (memo.has(key)) {
    return memo.get(key);
  }

  let best = {
    score: 0,
    usedDice: 0,
    groups: [],
  };

  for (const group of findAvailableScoringGroups(sortedDice)) {
    const remaining = removeGroup(sortedDice, group);

    if (remaining === null) {
      continue;
    }

    const remainderResult = evaluateSelection(remaining, memo);
    const candidate = {
      score: scoreGroup(group) + remainderResult.score,
      usedDice: group.length + remainderResult.usedDice,
      groups: [group, ...remainderResult.groups],
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

export function scoreSelection(dice) {
  const normalizedDice = normalizeDice(dice);

  if (normalizedDice.length === 0) {
    return {
      score: 0,
      valid: false,
      allScoring: false,
      selectedDiceCount: 0,
      scoringDiceCount: 0,
      groups: [],
    };
  }

  const result = evaluateSelection(normalizedDice, new Map());
  const allScoring = result.usedDice === normalizedDice.length;

  return {
    score: result.score,
    valid: allScoring && result.score > 0,
    allScoring,
    selectedDiceCount: normalizedDice.length,
    scoringDiceCount: result.usedDice,
    groups: result.groups.map(describeScoringGroup),
  };
}
