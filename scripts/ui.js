// ACTION REQUIRED

import { SCREEN, UI_PHASE } from "./state.js";
import { delay } from "./utils.js";

const DIE_FACE_URLS = Object.freeze({
  1: "assets/die-1.svg",
  2: "assets/die-2.svg",
  3: "assets/die-3.svg",
  4: "assets/die-4.svg",
  5: "assets/die-5.svg",
  6: "assets/die-6.svg",
});

const ROLL_ANIMATION_DURATION = 3000;
const ROLL_DURATION_DELTA = 350;

const START_FACE_INTERVAL = 45;
const MIN_END_FACE_INTERVAL = 260;
const MAX_END_FACE_INTERVAL = 420;
const DIE_SETTLE_BORDER_DELAY = 140;

const SCORE_APPEAR_DURATION = 220;
const SCORE_HOLD_DURATION = 650;
const SCORE_TRAVEL_DURATION = 260;
const SCORE_COUNT_DURATION = 360;
const BANK_STEP_DELAYS = Object.freeze({
  1000: 45,
  100: 30,
  10: 18,
  1: 10,
});

let elements = null;
let dieSlots = [];
let settledIndexes = new Set();
let scoreAnimationSequence = 0;
let localPlayerId = null;

const diceFaceCache = (() => {
  const images = new Map();
  let preloadPromise = null;

  function preload() {
    if (preloadPromise) return preloadPromise;

    preloadPromise = Promise.all(
      Object.entries(DIE_FACE_URLS).map(async ([value, src]) => {
        const image = new Image();
        image.src = src;
        image.alt = "";
        image.draggable = false;

        if (!image.complete) {
          await new Promise((resolve, reject) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", reject, { once: true });
          });
        }

        if (typeof image.decode === "function") {
          await image.decode();
        }

        images.set(Number(value), image);
      }),
    );

    return preloadPromise;
  }

  function getSource(value) {
    const image = images.get(value);

    if (!image) {
      throw new Error(`Die face ${value} has not been preloaded.`);
    }

    return image.src;
  }

  return { preload, getSource };
})();

class DieSlot {
  static STATE_CLASSES = [
    "die-slot--empty",
    "die-slot--filled",
    "die-slot--selected",
    "die-slot--held",
    "die-slot--scored",
    "die-slot--rollio",
    "die-slot--settled",
  ];

  constructor(element, index, onDieSelected) {
    this.element = element;
    this.index = index;
    this.value = null;

    this.element.addEventListener("click", () => {
      onDieSelected(this.index);
    });

    this.image = document.createElement("img");
    this.image.className = "die-face";
    this.image.alt = "";
    this.image.draggable = false;
    this.element.replaceChildren(this.image);
  }

  setState(stateName) {
    this.element.classList.remove(...DieSlot.STATE_CLASSES);
    this.element.classList.add(`die-slot--${stateName}`);
  }

  render({
    value = null,
    selected = false,
    held = false,
    rollio = false,
    settled = false,
    disabled = false,
  }) {
    this.value = value;

    if (value == null) {
      this.image.hidden = true;
      this.image.removeAttribute("src");
      this.element.disabled = true;
      this.element.setAttribute("aria-pressed", "false");
      this.setState(rollio ? "rollio" : "empty");
      return;
    }

    this.image.hidden = false;
    this.image.src = diceFaceCache.getSource(value);

    if (rollio) this.setState("rollio");
    else if (held) this.setState("held");
    else if (selected) this.setState("selected");
    else if (settled) this.setState("settled");
    else this.setState("filled");

    this.element.disabled = disabled;
    this.element.setAttribute("aria-pressed", String(selected));
  }

  showFace(value) {
    this.value = value;
    this.image.hidden = false;
    this.image.src = diceFaceCache.getSource(value);
  }
}

function requireInitialized() {
  if (!elements) {
    throw new Error("UI module has not been initialized.");
  }
}

function findOpponent(game, currentPlayerId) {
  if (!Array.isArray(game?.players)) {
    return null;
  }

  return (
    game.players.find((player) => player.player_id !== currentPlayerId) ?? null
  );
}

function getTurn(game) {
  return game?.turn && typeof game.turn === "object" ? game.turn : {};
}

export function getSelectedDice(state) {
  return [...state.ui.selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => state.ui.trayValues[index])
    .filter((value) => value !== null && value !== undefined);
}

function renderScreens(state) {
  elements.startSection.hidden = state.ui.screen !== SCREEN.WELCOME;
  elements.gameSection.hidden = state.ui.screen !== SCREEN.PLAY;
}

function createStamp(className, text) {
  const stamp = document.createElement("div");
  stamp.className = `dice-stamp ${className}`;
  stamp.textContent = text;
  stamp.hidden = true;
  stamp.setAttribute("aria-hidden", "true");
  elements.rolledDice.appendChild(stamp);
  return stamp;
}

function createScoreEffectsLayer() {
  const layer = document.createElement("div");
  layer.className = "score-effects";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);
  return layer;
}

function renderDiceStamps(state) {
  elements.rollioStamp.hidden = !state.ui.rollioStampVisible;
  elements.hotDiceStamp.hidden = !state.ui.hotDiceActive;
}

function renderScoreboard(state) {
  const game = state.game;
  const turn = getTurn(game);
  const players = Array.isArray(game?.players)
    ? game.players
    : [];

  const leftPlayer = players[0] ?? null;
  const rightPlayer = players[1] ?? null;
  const currentPlayerId = game?.current_player_id ?? null;

  elements.playerNameDisplay.textContent =
    leftPlayer?.name ?? "Player 1";
  elements.playerScore.textContent =
    leftPlayer?.score ?? 0;

  elements.opponentNameDisplay.textContent =
    rightPlayer?.name ?? "Player 2";
  elements.opponentScore.textContent =
    rightPlayer?.score ?? 0;

  elements.leftPlayerLabel.textContent = "Player 1";
  elements.rightPlayerLabel.textContent = "Player 2";

  elements.leftPlayerCard.dataset.playerId =
    leftPlayer?.player_id ?? "";
  elements.rightPlayerCard.dataset.playerId =
    rightPlayer?.player_id ?? "";

  elements.leftPlayerCard.classList.toggle(
    "player-score-card--active",
    leftPlayer?.player_id === currentPlayerId,
  );

  elements.rightPlayerCard.classList.toggle(
    "player-score-card--active",
    rightPlayer?.player_id === currentPlayerId,
  );

  const authoritativeTurnScore = turn.base_score ?? 0;
  const selectedScore = state.ui.selectedScore ?? 0;
  const submittedScore = state.ui.submittedScore ?? 0;

  elements.turnScore.textContent =
    authoritativeTurnScore +
    selectedScore +
    submittedScore;

}

function renderDiceTray(state) {
  const turnState = getTurn(state.game).state;

  const localTurn =
    localPlayerId === null ||
    state.game?.current_player_id === localPlayerId;

  const selectable =
    state.ui.phase === UI_PHASE.IDLE &&
    turnState === "WAITING_FOR_SELECTION" &&
    !state.ui.rollioActive &&
    localTurn;

  for (let index = 0; index < dieSlots.length; index += 1) {
    const value = state.ui.trayValues[index];
    const held = state.ui.heldIndexes.has(index);

    dieSlots[index].render({
      value,
      selected: state.ui.selectedIndexes.has(index),
      held,
      rollio: state.ui.rollioActive,
      settled: settledIndexes.has(index),
      disabled: !selectable || held,
    });
  }
}

function renderButtons(state) {
  const turnState = getTurn(state.game).state;
  const idle = state.ui.phase === UI_PHASE.IDLE;

  const localTurn =
    localPlayerId === null ||
    state.game?.current_player_id === localPlayerId;

  const active =
    state.ui.initialized &&
    state.game !== null &&
    idle &&
    !state.ui.rollioActive &&
    localTurn;

  const firstRoll = active && turnState === "READY_TO_ROLL";

  const validSelection =
    active &&
    turnState === "WAITING_FOR_SELECTION" &&
    state.ui.selectionIsValid;

  elements.rollButton.disabled = !(firstRoll || validSelection);
  elements.bankButton.disabled = !validSelection;
}

function randomDieValue(previousValue = null) {
  let value;

  do {
    value = Math.floor(Math.random() * 6) + 1;
  } while (value === previousValue);

  return value;
}

export function initialize({
  onStart,
  onGameTypeSelected,
  onRoll,
  onBank,
  onDieSelected,
}) {
  const handlers = {
    onStart,
    onGameTypeSelected,
    onRoll,
    onBank,
    onDieSelected,
  };

  for (const [name, handler] of Object.entries(handlers)) {
    if (typeof handler !== "function") {
      throw new TypeError(`UI initialization requires ${name}.`);
    }
  }

  elements = {
    playerName: document.getElementById("playerName"),
    startButton: document.getElementById("startButton"),
    startSection: document.getElementById("startSection"),
    gameSection: document.getElementById("gameSection"),
    playerNameDisplay: document.getElementById("playerNameDisplay"),
    playerScore: document.getElementById("playerScore"),
    opponentNameDisplay: document.getElementById("opponentNameDisplay"),
    opponentScore: document.getElementById("opponentScore"),
    turnScore: document.getElementById("turnScore"),
    message: document.getElementById("message"),
    rollButton: document.getElementById("rollButton"),
    bankButton: document.getElementById("bankButton"),
    rolledDice: document.getElementById("rolledDice"),
    matchmakingStatus:
      document.getElementById("matchmakingStatus"),
    gameTypeDialog:
      document.getElementById("gameTypeDialog"),
    gameTypeButtons: Array.from(
      document.querySelectorAll("[data-game-type]"),
    ),
  };

  for (const [name, element] of Object.entries(elements)) {
    if (name === "gameTypeButtons") {
      continue;
    }

    if (!element) {
      throw new Error(`Required DOM element was not found: ${name}`);
    }
  }

  elements.leftPlayerCard =
    elements.playerNameDisplay.closest(".player-score-card");
  elements.rightPlayerCard =
    elements.opponentNameDisplay.closest(".player-score-card");

  elements.leftPlayerLabel =
    elements.leftPlayerCard?.querySelector(
      ".player-score-card__label",
    );

  elements.rightPlayerLabel =
    elements.rightPlayerCard?.querySelector(
      ".player-score-card__label",
    );

  if (
    !elements.leftPlayerCard ||
    !elements.rightPlayerCard ||
    !elements.leftPlayerLabel ||
    !elements.rightPlayerLabel
  ) {
    throw new Error("Player scoreboard cards were not found.");
  }

  elements.scoreEffects = createScoreEffectsLayer();

  dieSlots = Array.from(
    elements.rolledDice.querySelectorAll(".die-slot"),
    (element, index) => new DieSlot(element, index, onDieSelected),
  );

  elements.rollioStamp = createStamp("dice-stamp--rollio", "ROLLIO!");
  elements.hotDiceStamp = createStamp("dice-stamp--hot", "HOT DICE!");

  elements.startButton.addEventListener("click", onStart);

  for (const button of elements.gameTypeButtons) {
    button.addEventListener("click", () => {
      onGameTypeSelected(button.dataset.gameType);
    });
  }

  elements.rollButton.addEventListener("click", onRoll);
  elements.bankButton.addEventListener("click", onBank);
}

export function preloadAssets() {
  return diceFaceCache.preload();
}

export function readPlayerName() {
  requireInitialized();
  return elements.playerName.value;
}

export function setLocalPlayerId(playerId) {
  localPlayerId = playerId ?? null;
}

export function openGameTypeDialog() {
  requireInitialized();

  elements.matchmakingStatus.hidden = true;
  elements.matchmakingStatus.textContent = "";

  for (const button of elements.gameTypeButtons) {
    button.disabled = false;
  }

  if (!elements.gameTypeDialog.open) {
    elements.gameTypeDialog.showModal();
  }
}

export function closeGameTypeDialog() {
  requireInitialized();

  if (elements.gameTypeDialog.open) {
    elements.gameTypeDialog.close();
  }
}

export function showMatchmakingStatus(message) {
  requireInitialized();

  const active = Boolean(message);

  elements.matchmakingStatus.hidden = !active;
  elements.matchmakingStatus.textContent = message ?? "";

  for (const button of elements.gameTypeButtons) {
    button.disabled = active;
  }
}


export function render(state) {
  requireInitialized();
  renderScreens(state);
  renderScoreboard(state);
  renderDiceTray(state);
  renderDiceStamps(state);
  elements.message.textContent = state.ui.message;
  renderButtons(state);
}

function getFeedbackTone(groups, difference) {
  if (difference < 0) {
    return "removed";
  }

  const priority = [
    "combination",
    "straight",
    "kind",
    "single",
  ];

  for (const tone of priority) {
    if (groups.some((group) => group.tone === tone)) {
      return tone;
    }
  }

  return "single";
}

function animateTurnScore(fromScore, toScore, sequence) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const scoreDifference = toScore - fromScore;

    function update(now) {
      if (sequence !== scoreAnimationSequence) {
        resolve();
        return;
      }

      const elapsed = now - startTime;
      const progress = Math.min(elapsed / SCORE_COUNT_DURATION, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      elements.turnScore.textContent = Math.round(
        fromScore + scoreDifference * easedProgress,
      );

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        elements.turnScore.textContent = toScore;
        elements.turnScore.classList.remove("turn-score--counting");
        resolve();
      }
    }

    elements.turnScore.classList.add("turn-score--counting");
    elements.turnScore.textContent = fromScore;
    requestAnimationFrame(update);
  });
}

function createFloatingScore(difference, groups) {
  const label = document.createElement("div");
  const tone = getFeedbackTone(groups, difference);

  label.className = `score-float score-float--${tone}`;

  const value = document.createElement("span");
  value.className = "score-float__value";
  value.textContent =
    difference > 0 ? `+${difference}` : String(difference);

  label.appendChild(value);
  elements.scoreEffects.appendChild(label);
  return label;
}

function getScoreCenters() {
  const trayRect = elements.rolledDice.getBoundingClientRect();
  const scoreRect = elements.turnScore.getBoundingClientRect();

  return {
    tray: {
      x: trayRect.left + trayRect.width / 2,
      y: trayRect.top + trayRect.height / 2,
    },
    turnScore: {
      x: scoreRect.left + scoreRect.width / 2,
      y: scoreRect.top + scoreRect.height / 2,
    },
  };
}

function placeFloatingScore(label, point) {
  label.style.left = `${point.x}px`;
  label.style.top = `${point.y}px`;
}

async function animatePositiveScore({
  difference,
  groups,
  fromScore,
  toScore,
  sequence,
}) {
  const centers = getScoreCenters();
  const label = createFloatingScore(difference, groups);

  placeFloatingScore(label, centers.tray);

  const appear = label.animate(
    [
      {
        transform: "translate(-50%, -50%) scale(0.45)",
        opacity: 0,
      },
      {
        transform: "translate(-50%, -50%) scale(1.18)",
        opacity: 1,
      },
      {
        transform: "translate(-50%, -50%) scale(1)",
        opacity: 1,
      },
    ],
    {
      duration: SCORE_APPEAR_DURATION,
      easing: "cubic-bezier(0.2, 0.9, 0.25, 1)",
      fill: "forwards",
    },
  );

  await appear.finished.catch(() => {});

  if (sequence !== scoreAnimationSequence) {
    label.remove();
    return;
  }

  await delay(SCORE_HOLD_DURATION);

  if (sequence !== scoreAnimationSequence) {
    label.remove();
    return;
  }

  const deltaX = centers.turnScore.x - centers.tray.x;
  const deltaY = centers.turnScore.y - centers.tray.y;

  const travel = label.animate(
    [
      {
        transform: "translate(-50%, -50%) scale(1)",
        opacity: 1,
      },
      {
        transform:
          `translate(calc(-50% + ${deltaX}px), ` +
          `calc(-50% + ${deltaY}px)) scale(0.62)`,
        opacity: 0.15,
      },
    ],
    {
      duration: SCORE_TRAVEL_DURATION,
      easing: "cubic-bezier(0.45, 0, 0.85, 0.45)",
      fill: "forwards",
    },
  );

  await travel.finished.catch(() => {});
  label.remove();

  if (sequence === scoreAnimationSequence) {
    await animateTurnScore(fromScore, toScore, sequence);
  }
}

async function animateRemovedScore({
  difference,
  groups,
  fromScore,
  toScore,
  sequence,
}) {
  await animateTurnScore(fromScore, toScore, sequence);

  if (sequence !== scoreAnimationSequence) {
    return;
  }

  const centers = getScoreCenters();
  const label = createFloatingScore(difference, groups);

  placeFloatingScore(label, centers.turnScore);

  const deltaX = centers.tray.x - centers.turnScore.x;
  const deltaY = centers.tray.y - centers.turnScore.y;

  const travel = label.animate(
    [
      {
        transform: "translate(-50%, -50%) scale(0.62)",
        opacity: 0.15,
      },
      {
        transform:
          `translate(calc(-50% + ${deltaX}px), ` +
          `calc(-50% + ${deltaY}px)) scale(1)`,
        opacity: 1,
      },
    ],
    {
      duration: SCORE_TRAVEL_DURATION,
      easing: "cubic-bezier(0.15, 0.55, 0.55, 1)",
      fill: "forwards",
    },
  );

  await travel.finished.catch(() => {});
  travel.cancel();

  if (sequence !== scoreAnimationSequence) {
    label.remove();
    return;
  }

  placeFloatingScore(label, centers.tray);
  label.style.transform = "translate(-50%, -50%) scale(1)";
  label.style.opacity = "1";

  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });

  await delay(SCORE_HOLD_DURATION);

  if (sequence !== scoreAnimationSequence) {
    label.remove();
    return;
  }

  const disappear = label.animate(
    [
      {
        transform: "translate(-50%, -50%) scale(1)",
        opacity: 1,
      },
      {
        transform: "translate(-50%, -50%) scale(0.45)",
        opacity: 0,
      },
    ],
    {
      duration: SCORE_APPEAR_DURATION,
      easing: "cubic-bezier(0.75, 0, 0.8, 0.1)",
      fill: "forwards",
    },
  );

  await disappear.finished.catch(() => {});
  label.remove();
}

export function animateScoringFeedback({
  fromScore,
  toScore,
  difference,
  groups = [],
}) {
  requireInitialized();

  scoreAnimationSequence += 1;
  const sequence = scoreAnimationSequence;

  if (difference > 0) {
    void animatePositiveScore({
      difference,
      groups,
      fromScore,
      toScore,
      sequence,
    });
  } else {
    void animateRemovedScore({
      difference,
      groups,
      fromScore,
      toScore,
      sequence,
    });
  }
}

function getBankTransferStep(remaining) {
  if (remaining >= 1000) return 1000;
  if (remaining >= 100) return 100;
  if (remaining >= 10) return 10;
  return 1;
}

function getPlayerScoreElement(playerId) {
  if (
    elements.leftPlayerCard.dataset.playerId ===
    String(playerId)
  ) {
    return elements.playerScore;
  }

  if (
    elements.rightPlayerCard.dataset.playerId ===
    String(playerId)
  ) {
    return elements.opponentScore;
  }

  return null;
}

export async function animateBankTransfer({
  bankedScore,
  fromPlayerScore,
  toPlayerScore,
  playerId,
}) {
  requireInitialized();

  const playerScoreElement =
    getPlayerScoreElement(playerId);

  if (!playerScoreElement) {
    throw new Error(
      "The banking player's score display was not found.",
    );
  }

  scoreAnimationSequence += 1;
  const sequence = scoreAnimationSequence;

  let remaining = Math.max(0, bankedScore);
  let displayedTurnScore = remaining;
  let displayedPlayerScore = fromPlayerScore;

  elements.turnScore.textContent = displayedTurnScore;
  playerScoreElement.textContent = displayedPlayerScore;

  while (remaining > 0) {
    if (sequence !== scoreAnimationSequence) {
      return;
    }

    const step = getBankTransferStep(remaining);

    remaining -= step;
    displayedTurnScore -= step;
    displayedPlayerScore += step;

    elements.turnScore.textContent = displayedTurnScore;
    playerScoreElement.textContent = displayedPlayerScore;

    await delay(BANK_STEP_DELAYS[step]);
  }

  if (sequence !== scoreAnimationSequence) {
    return;
  }

  elements.turnScore.textContent = 0;
  playerScoreElement.textContent = toPlayerScore;
}

export function animateRoll(
  openIndexes,
  baseDuration = ROLL_ANIMATION_DURATION,
) {
  requireInitialized();

  for (const index of openIndexes) {
    settledIndexes.delete(index);
    dieSlots[index].setState("filled");
  }

  const animations = openIndexes.map((index) => {
    const profile = createRollProfile(baseDuration);

    return animateDie(index, profile);
  });

  return Promise.all(animations);
}

function createRollProfile(baseDuration) {
  return {
    totalDuration: Math.max(
      1000,
      baseDuration +
        randomBetween(
          -ROLL_DURATION_DELTA,
          ROLL_DURATION_DELTA,
        ),
    ),

    endFaceInterval: randomBetween(
      MIN_END_FACE_INTERVAL,
      MAX_END_FACE_INTERVAL,
    ),

    easingPower: randomBetween(2.3, 3.2),
  };
}

async function animateDie(index, profile) {
  const slot = dieSlots[index];
  const startTime = performance.now();

  let previousValue = null;

  while (true) {
    const elapsed = performance.now() - startTime;

    if (elapsed >= profile.totalDuration) {
      break;
    }

    const progress = Math.min(
      elapsed / profile.totalDuration,
      1,
    );

    const easedProgress = Math.pow(
      progress,
      profile.easingPower,
    );

    const interval = interpolate(
      START_FACE_INTERVAL,
      profile.endFaceInterval,
      easedProgress,
    );

    const value = randomDieValue(previousValue);

    previousValue = value;
    slot.showFace(value);

    const remainingDuration =
      profile.totalDuration - elapsed;

    await delay(
      Math.min(interval, remainingDuration),
    );
  }

  slot.setState("filled");
}

export async function showSettledBorders(indexes) {
  requireInitialized();

  await delay(DIE_SETTLE_BORDER_DELAY);

  for (const index of indexes) {
    settledIndexes.add(index);
    dieSlots[index].setState("settled");
  }
}

function interpolate(start, end, amount) {
  return start + (end - start) * amount;
}

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}
