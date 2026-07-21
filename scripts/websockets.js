// ACTION REQUIRED

const DEFAULT_WEBSOCKET_URL =
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}` +
  `//${window.location.hostname}:8000`;

let socket = null;
let responseHandler = null;


/**
 * Register the handler for server ApiResponse messages.
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
 * Handle a transport-level message.
 */
function handleTransportMessage(message) {
  if (message.transport === "PING") {
    sendTransportMessage("PONG", {
      sent_at: message.transport_data?.sent_at ?? null,
    });

    return;
  }

  console.warn(
    `Unhandled WebSocket transport message: ${message.transport}`,
  );
}


/**
 * Process one message received from the server.
 */
async function handleServerMessage(message) {
  if (
    message &&
    typeof message === "object" &&
    !Array.isArray(message) &&
    typeof message.transport === "string"
  ) {
    handleTransportMessage(message);
    return;
  }

  await responseHandler(message);
}


/**
 * Open a WebSocket connection for one existing game.
 */
export function connectWebSocket({
  gameId,
  websocketUrl = DEFAULT_WEBSOCKET_URL,
}) {
  if (!responseHandler) {
    throw new Error("WebSocket module has not been initialized.");
  }

  if (!gameId) {
    throw new Error("connectWebSocket requires a gameId.");
  }

  if (!websocketUrl) {
    throw new Error("connectWebSocket requires a websocketUrl.");
  }

  disconnectWebSocket();

  const connectionUrl =
    `${websocketUrl}/ws/game/${encodeURIComponent(gameId)}`;

  return new Promise((resolve, reject) => {
    const currentSocket = new WebSocket(connectionUrl);
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

        const serverMessage = JSON.parse(text);

        await handleServerMessage(serverMessage);
      } catch (error) {
        console.error(
          "Could not process WebSocket message:",
          error,
        );
      }
    });

    currentSocket.addEventListener("error", () => {
      if (!connectionSettled) {
        connectionSettled = true;

        reject(
          new Error(
            "Unable to establish the WebSocket connection.",
          ),
        );
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
 * Send one gameplay command.
 */
export function sendCommand(command, commandData = {}) {
  if (!command || typeof command !== "string") {
    throw new TypeError("sendCommand requires a command string.");
  }

  if (
    !commandData ||
    typeof commandData !== "object" ||
    Array.isArray(commandData)
  ) {
    throw new TypeError(
      "sendCommand requires commandData to be an object.",
    );
  }

  sendMessage({
    command,
    command_data: commandData,
  });
}


/**
 * Send one transport-level message.
 */
function sendTransportMessage(transport, transportData = {}) {
  sendMessage({
    transport,
    transport_data: transportData,
  });
}


/**
 * Serialize and send one message over the active socket.
 */
function sendMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("The gameplay WebSocket is not connected.");
  }

  const serializedMessage = JSON.stringify(message);
  
  socket.send(serializedMessage);
}


/**
 * Close the active gameplay WebSocket.
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
}


/**
 * Report whether gameplay commands can currently be sent.
 */
export function isWebSocketConnected() {
  return socket?.readyState === WebSocket.OPEN;
}