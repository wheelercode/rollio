// ACTION REQUIRED

import { SCREEN, UI_PHASE } from "./state.js";
import { delay, getCurrentPlayer } from "./utils.js";

const DIE_FACE_URLS = Object.freeze({
  1: "assets/die-1.svg",
  2: "assets/die-2.svg",
  3: "assets/die-3.svg",
  4: "assets/die-4.svg",
  5: "assets/die-5.svg",
  6: "assets/die-6.svg",
});

const ROLL_ANIMATION_DURATION = 2300;
const ROLL_DURATION_VARIANCE = 500;

const MIN_SUSPENSE_DURATION = 250;
const MAX_SUSPENSE_DURATION = 900;

const START_FACE_INTERVAL = 45;
const MIN_END_FACE_INTERVAL = 180;
const MAX_END_FACE_INTERVAL = 360;

let elements = null;
let dieSlots = [];
let settledIndexes = new Set();

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

function getSelectedValues(state) {
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

function renderDiceStamps(state) {
  elements.rollioStamp.hidden = !state.ui.rollioStampVisible;

  elements.hotDiceStamp.hidden = !state.ui.hotDiceActive;
}

function renderScoreboard(state) {
  const game = state.game;
  const turn = getTurn(game);
  const currentPlayer = getCurrentPlayer(game);
  const opponent = findOpponent(game, game?.current_player_id);

  elements.playerNameDisplay.textContent = currentPlayer?.name ?? "Player 1";
  elements.playerScore.textContent = currentPlayer?.score ?? 0;
  elements.opponentNameDisplay.textContent = opponent?.name ?? "Opponent";
  elements.opponentScore.textContent = opponent?.score ?? 0;
  elements.targetScore.textContent = game?.target_score ?? 0;

  const authoritativeTurnScore = turn.base_score ?? 0;
  const submittedScore = state.ui.submittedScore ?? 0;

  elements.turnScore.textContent =
    authoritativeTurnScore + submittedScore;

  elements.rollNumber.textContent = turn.roll_number ?? 0;

  const scoredDice = Array.isArray(turn.scored_dice) ? turn.scored_dice : [];
  elements.scoredDice.textContent =
    scoredDice.length > 0 ? scoredDice.join(", ") : "None";

  const selectedDice = getSelectedValues(state);
  elements.selectedDice.textContent =
    selectedDice.length > 0 ? selectedDice.join(", ") : "None";
}

function renderDiceTray(state) {
  const turnState = getTurn(state.game).state;

  const selectable =
    state.ui.phase === UI_PHASE.IDLE &&
    turnState === "WAITING_FOR_SELECTION" &&
    !state.ui.rollioActive;

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

  const active =
    state.ui.initialized &&
    state.game !== null &&
    idle &&
    !state.ui.rollioActive;

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

export function initialize({ onStart, onRoll, onBank, onDieSelected }) {
  const handlers = {
    onStart,
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
    targetScore: document.getElementById("targetScore"),
    turnScore: document.getElementById("turnScore"),
    rollNumber: document.getElementById("rollNumber"),
    scoredDice: document.getElementById("scoredDice"),
    selectedDice: document.getElementById("selectedDice"),
    message: document.getElementById("message"),
    rollButton: document.getElementById("rollButton"),
    bankButton: document.getElementById("bankButton"),
    output: document.getElementById("output"),
    rolledDice: document.getElementById("rolledDice"),
  };

  for (const [name, element] of Object.entries(elements)) {
    if (!element)
      throw new Error(`Required DOM element was not found: ${name}`);
  }

  dieSlots = Array.from(
    elements.rolledDice.querySelectorAll(".die-slot"),
    (element, index) => new DieSlot(element, index, onDieSelected),
  );

  elements.rollioStamp = createStamp("dice-stamp--rollio", "ROLLIO!");
  elements.hotDiceStamp = createStamp("dice-stamp--hot", "HOT DICE!");

  elements.startButton.addEventListener("click", onStart);
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

export function render(state) {
  requireInitialized();
  renderScreens(state);
  renderScoreboard(state);
  renderDiceTray(state);
  renderDiceStamps(state);
  elements.message.textContent = state.ui.message;
  renderButtons(state);
  elements.output.textContent = state.ui.lastApiResponse
    ? JSON.stringify(state.ui.lastApiResponse, null, 2)
    : "No request sent yet.";
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
  const durationOffset = randomBetween(
    -ROLL_DURATION_VARIANCE,
    ROLL_DURATION_VARIANCE,
  );

  const totalDuration = Math.max(1000, baseDuration + durationOffset);

  const suspenseDuration = randomBetween(
    MIN_SUSPENSE_DURATION,
    Math.min(MAX_SUSPENSE_DURATION, totalDuration * 0.45),
  );

  return {
    totalDuration,
    suspenseDuration,

    endFaceInterval: randomBetween(
      MIN_END_FACE_INTERVAL,
      MAX_END_FACE_INTERVAL,
    ),

    changeAtLastInstant: Math.random() < 0.5,

    finalChangeLeadTime: randomBetween(35, 140),

    easingPower: randomBetween(2.2, 4.2),
  };
}

async function animateDie(index, profile) {
  const slot = dieSlots[index];
  const startTime = performance.now();

  const slowdownDuration = profile.totalDuration - profile.suspenseDuration;

  let previousValue = null;

  while (true) {
    const elapsed = performance.now() - startTime;

    if (elapsed >= slowdownDuration) {
      break;
    }

    const progress = Math.min(elapsed / slowdownDuration, 1);

    const easedProgress = Math.pow(progress, profile.easingPower);

    const interval = interpolate(
      START_FACE_INTERVAL,
      profile.endFaceInterval,
      easedProgress,
    );

    const value = randomDieValue(previousValue);

    previousValue = value;
    slot.showFace(value);

    const remainingSlowdownTime = slowdownDuration - elapsed;

    await delay(Math.min(interval, remainingSlowdownTime));
  }

  const elapsed = performance.now() - startTime;
  const remainingDuration = Math.max(profile.totalDuration - elapsed, 0);

  if (
    profile.changeAtLastInstant &&
    remainingDuration > profile.finalChangeLeadTime
  ) {
    await delay(remainingDuration - profile.finalChangeLeadTime);

    const finalValue = randomDieValue(previousValue);

    slot.showFace(finalValue);

    await delay(profile.finalChangeLeadTime);
  } else {
    await delay(remainingDuration);
  }

  settledIndexes.add(index);
  slot.setState("settled");
}

function easeInCubic(value) {
  return value * value * value;
}

function interpolate(start, end, amount) {
  return start + (end - start) * amount;
}

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}
