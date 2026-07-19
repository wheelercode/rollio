const DEFAULT_WEBSOCKET_URL =
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}` +
  `//${window.location.hostname}:8000`;

let socket = null;
let responseHandler = null;
let gameId = null;
let clientId = null;

/**
 * Register the same response handler used by the HTTP API module.
 *
 * Every valid server message is parsed and passed to this handler.
 */
export function initializeWebSocket(webSocketResponseHandler) {
  if (typeof webSocketResponseHandler !== "function") {
    throw new TypeError(
      "initializeWebSocket requires a response handler function.",
    );
  }

  responseHandler = webSocketResponseHandler;
}

/**
 * Open the gameplay WebSocket connection.
 *
 * The HTTP game-management API should provide gameId, clientId,
 * and optionally the complete WebSocket URL.
 */
export function connectWebSocket({
  gameId: newGameId,
  clientId: newClientId,
  websocketUrl = DEFAULT_WEBSOCKET_URL,
}) {
  if (!responseHandler) {
    throw new Error("WebSocket module has not been initialized.");
  }

  if (!newGameId) {
    throw new Error("connectWebSocket requires a gameId.");
  }

  if (!newClientId) {
    throw new Error("connectWebSocket requires a clientId.");
  }

  if (!websocketUrl) {
    throw new Error("connectWebSocket requires a websocketUrl.");
  }

  disconnectWebSocket();

  gameId = newGameId;
  clientId = newClientId;

  return new Promise((resolve, reject) => {
    const currentSocket = new WebSocket(websocketUrl);
    socket = currentSocket;

    let connectionSettled = false;

    currentSocket.addEventListener("open", () => {
      connectionSettled = true;
      resolve();
    });

    currentSocket.addEventListener("message", async (event) => {
      try {
        const text =
          typeof event.data === "string"
            ? event.data
            : await event.data.text();

        const serverResponse = JSON.parse(text);
        await responseHandler(serverResponse);
      } catch (error) {
        console.error("Could not process WebSocket message:", error);
      }
    });

    currentSocket.addEventListener("error", () => {
      if (!connectionSettled) {
        connectionSettled = true;
        reject(new Error("Unable to establish the WebSocket connection."));
      }
    });

    currentSocket.addEventListener("close", (event) => {
      if (socket === currentSocket) {
        socket = null;
      }

      if (!connectionSettled) {
        connectionSettled = true;

        reject(
          new Error(
            `WebSocket closed before connecting. Code: ${event.code}`,
          ),
        );
      }
    });
  });
}

/**
 * Send one gameplay command to the authoritative game server.
 */
export function sendCommand(command, commandData = {}) {
  if (!command || typeof command !== "string") {
    throw new TypeError("sendCommand requires a command string.");
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("The gameplay WebSocket is not connected.");
  }

  const message = {
    protocol_version: 1,
    game_id: gameId,
    client_id: clientId,
    command,
    command_data: commandData ?? {},
  };

  socket.send(JSON.stringify(message));
}

/**
 * Close the current gameplay connection.
 */
export function disconnectWebSocket() {
  const currentSocket = socket;
  socket = null;

  if (
    currentSocket &&
    (
      currentSocket.readyState === WebSocket.CONNECTING ||
      currentSocket.readyState === WebSocket.OPEN
    )
  ) {
    currentSocket.close(1000, "Client disconnected.");
  }

  gameId = null;
  clientId = null;
}

/**
 * Report whether gameplay commands can currently be sent.
 */
export function isWebSocketConnected() {
  return socket?.readyState === WebSocket.OPEN;
}