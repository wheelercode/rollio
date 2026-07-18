import { state, UI_STATE } from "./state.js";

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

const DiceFaceCache = (() => {
  const images = new Map();
  let preloadPromise = null;

  function preload() {
    if (preloadPromise) {
      return preloadPromise;
    }

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

    this.element.addEventListener("click", () => {
      onDieSelected(this.index);
    });
    
    this.image = document.createElement("img");
    this.image.className = "die-face";
    this.image.alt = "";
    this.image.draggable = false;

    this.element.replaceChildren(this.image);

    this.value = null;
  }

  setState(stateName) {
    this.element.classList.remove(...DieSlot.STATE_CLASSES);
    this.element.classList.add(`die-slot--${stateName}`);
  }

  render({
    value = null,
    selected = false,
    held = false,
    scored = false,
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
    this.image.src = DiceFaceCache.getSource(value);

    if (rollio) {
      this.setState("rollio");
    } else if (held) {
      this.setState("held");
    } else if (scored) {
      this.setState("scored");
    } else if (selected) {
      this.setState("selected");
    } else {
      this.setState("filled");
    }

    this.element.disabled = disabled;
    this.element.setAttribute("aria-pressed", String(selected));
  }

  showRandomFace() {
    let value;

    do {
      value = Math.floor(Math.random() * 6) + 1;
    } while (value === this.value);

    this.value = value;
    this.image.hidden = false;
    this.image.src = DiceFaceCache.getSource(value);
  }
}
let dieSlots = [];

export function initializeDiceTray(trayElement, onDieSelected) {
  if (!trayElement) {
    throw new Error("Dice tray element was not found.");
  }

  dieSlots = Array.from(
    trayElement.querySelectorAll(".die-slot"),
    (element, index) => new DieSlot(element, index, onDieSelected),
  );
}

export function preloadDiceFaces() {
  return DiceFaceCache.preload();
}

export function getTraySize() {
  return dieSlots.length;
}

export function getOpenTrayIndexes() {
  const indexes = [];

  for (let index = 0; index < dieSlots.length; index += 1) {
    if (!state.heldIndexes.has(index)) {
      indexes.push(index);
    }
  }

  return indexes;
}

export function getRollDiceCount() {
  return getOpenTrayIndexes().length;
}

export function getReturnedRolledDice(data) {
  const turn =
    data.turn && typeof data.turn === "object" ? data.turn : {};
  const returnedDice = turn.rolled_dice ?? data.rolled_dice;

  return Array.isArray(returnedDice) ? returnedDice : null;
}

export function placeRolledDiceInOpenSlots(returnedDice) {
  const openIndexes = getOpenTrayIndexes();

  if (returnedDice.length !== openIndexes.length) {
    throw new Error(
      `Server returned ${returnedDice.length} dice, ` +
        `but ${openIndexes.length} tray slots are available.`,
    );
  }

  const nextDice = [...state.rolledDice];

  for (let offset = 0; offset < openIndexes.length; offset += 1) {
    nextDice[openIndexes[offset]] = returnedDice[offset];
  }

  state.rolledDice = nextDice;
  state.displayedDice = [...nextDice];
}

export function placeDiceInEntireTray(returnedDice) {
  if (returnedDice.length !== dieSlots.length) {
    throw new Error(
      `Server returned ${returnedDice.length} dice ` +
        `for a ${dieSlots.length}-slot tray.`,
    );
  }

  state.rolledDice = [...returnedDice];
  state.displayedDice = [...returnedDice];
}

export function renderDiceTray() {
  const dice =
    state.uiState === UI_STATE.ROLLING
      ? state.displayedDice
      : state.rolledDice;

  const diceAreSelectable =
    state.uiState !== UI_STATE.ROLLING &&
    state.turnState === "WAITING_FOR_SELECTION" &&
    !state.rollioActive;

  for (let index = 0; index < dieSlots.length; index += 1) {
    const isHeld = state.heldIndexes.has(index);
    const isSelected = state.selectedIndexes.has(index);
    const isRollio =
      state.rollioActive && Number.isInteger(dice[index]);

    dieSlots[index].render({
      value: dice[index],
      selected: isSelected,
      held: isHeld,
      rollio: isRollio,
      disabled: !diceAreSelectable || isHeld,
    });
  }
}

function randomDieValue(previousValue = null) {
  let value;

  do {
    value = Math.floor(Math.random() * 6) + 1;
  } while (value === previousValue);

  return value;
}

export function animateRollingDice(
  duration = ROLL_ANIMATION_DURATION,
) {
  const openIndexes = getOpenTrayIndexes();

  return new Promise((resolve) => {
    const startTime = performance.now();
    let lastFaceChange = 0;

    state.displayedDice = [...state.rolledDice];

    for (const index of openIndexes) {
      state.displayedDice[index] = randomDieValue();
    }

    renderDiceTray();

    function frame(currentTime) {
      const elapsed = currentTime - startTime;

      if (currentTime - lastFaceChange >= ROLL_FACE_INTERVAL) {
        const nextDisplayedDice = [...state.displayedDice];

        for (const index of openIndexes) {
          nextDisplayedDice[index] = randomDieValue(
            state.displayedDice[index],
          );
        }

        state.displayedDice = nextDisplayedDice;
        renderDiceTray();
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
