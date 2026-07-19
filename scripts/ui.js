import { SCREEN, UI_PHASE } from "./state.js";

const DIE_FACE_URLS = Object.freeze({
  1: "assets/die-1.svg",
  2: "assets/die-2.svg",
  3: "assets/die-3.svg",
  4: "assets/die-4.svg",
  5: "assets/die-5.svg",
  6: "assets/die-6.svg",
});

const ROLL_ANIMATION_DURATION = 3000;
const ROLL_FACE_INTERVAL = 60;

let elements = null;
let dieSlots = [];

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
    disabled = false,
  }) {
    this.value = value;

    if (value == null) {
      this.image.hidden = true;
      this.image.removeAttribute("src");
      this.element.disabled = true;
      this.element.setAttribute("aria-pressed", "false");
      this.setState("empty");
      return;
    }

    this.image.hidden = false;
    this.image.src = diceFaceCache.getSource(value);

    if (rollio) this.setState("rollio");
    else if (held) this.setState("held");
    else if (selected) this.setState("selected");
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

function findOpponent(players, currentPlayer) {
  if (!Array.isArray(players) || !currentPlayer) return null;
  return players.find((player) => player.name !== currentPlayer.name) ?? null;
}

function getTurn(game) {
  return game?.turn && typeof game.turn === "object" ? game.turn : {};
}

function getCurrentPlayer(game) {
  const turn = getTurn(game);
  return game?.current_player ?? turn.player ?? null;
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

function renderScoreboard(state) {
  const game = state.game;
  const turn = getTurn(game);
  const currentPlayer = getCurrentPlayer(game);
  const opponent = game?.opponent ?? findOpponent(game?.players, currentPlayer);

  elements.playerNameDisplay.textContent = currentPlayer?.name ?? "Player 1";
  elements.playerScore.textContent = currentPlayer?.score ?? 0;
  elements.opponentNameDisplay.textContent = opponent?.name ?? "Opponent";
  elements.opponentScore.textContent = opponent?.score ?? 0;
  elements.targetScore.textContent = game?.target_score ?? 0;
  elements.turnScore.textContent = turn.base_score ?? 0;
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
      rollio: state.ui.rollioActive && Number.isInteger(value),
      disabled: !selectable || held,
    });
  }
}

function renderButtons(state) {
  const turnState = getTurn(state.game).state;
  const idle = state.ui.phase === UI_PHASE.IDLE;
  const active = state.ui.initialized && state.game !== null && idle;

  const canRoll =
    active &&
    (turnState === "READY_TO_ROLL" || turnState === "READY_TO_CONTINUE");

  const canHold =
    active &&
    turnState === "WAITING_FOR_SELECTION" &&
    state.ui.selectionIsValid &&
    !state.ui.rollioActive;

  const canBank = active && turnState === "READY_TO_CONTINUE";

  elements.rollButton.disabled = !canRoll;
  elements.holdButton.disabled = !canHold;
  elements.bankButton.disabled = !canBank;
}

function randomDieValue(previousValue = null) {
  let value;

  do {
    value = Math.floor(Math.random() * 6) + 1;
  } while (value === previousValue);

  return value;
}

export function initialize({ onStart, onRoll, onHold, onBank, onDieSelected }) {
  const handlers = { onStart, onRoll, onHold, onBank, onDieSelected };

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
    holdButton: document.getElementById("holdButton"),
    bankButton: document.getElementById("bankButton"),
    output: document.getElementById("output"),
    rolledDice: document.getElementById("rolledDice"),
  };

  for (const [name, element] of Object.entries(elements)) {
    if (!element) throw new Error(`Required DOM element was not found: ${name}`);
  }

  dieSlots = Array.from(
    elements.rolledDice.querySelectorAll(".die-slot"),
    (element, index) => new DieSlot(element, index, onDieSelected),
  );

  elements.startButton.addEventListener("click", onStart);
  elements.rollButton.addEventListener("click", onRoll);
  elements.holdButton.addEventListener("click", onHold);
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
  elements.message.textContent = state.ui.message;
  renderButtons(state);
  elements.output.textContent = state.ui.lastApiResponse
    ? JSON.stringify(state.ui.lastApiResponse, null, 2)
    : "No request sent yet.";
}

export function animateRoll(openIndexes, duration = ROLL_ANIMATION_DURATION) {
  requireInitialized();

  return new Promise((resolve) => {
    const startTime = performance.now();
    let lastFaceChange = 0;
    const displayedValues = new Map();

    for (const index of openIndexes) {
      const value = randomDieValue();
      displayedValues.set(index, value);
      dieSlots[index].showFace(value);
    }

    function frame(currentTime) {
      const elapsed = currentTime - startTime;

      if (currentTime - lastFaceChange >= ROLL_FACE_INTERVAL) {
        for (const index of openIndexes) {
          const value = randomDieValue(displayedValues.get(index));
          displayedValues.set(index, value);
          dieSlots[index].showFace(value);
        }

        lastFaceChange = currentTime;
      }

      if (elapsed < duration) {
        requestAnimationFrame(frame);
        return;
      }

      resolve();
    }

    requestAnimationFrame(frame);
  });
}
