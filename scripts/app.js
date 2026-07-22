import { initialize } from "./game.js";
import { getState } from "./state.js";
import { initializeOptimalPlayDebug } from "./solver-debug.js";

initialize();
initializeOptimalPlayDebug(getState);
