const DEFAULT_WEBSOCKET_URL =
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}` +
  `//${window.location.hostname}:8000`;

let socket = null;
let responseHandler = null;

export function initializeWebSocket(webSocketResponseHandler) {
  if (typeof webSocketResponseHandler !== "function") {
    throw new TypeError(
      "initializeWebSocket requires a response handler function.",
    );
  }

  responseHandler = webSocketResponseHandler;
}

function sendMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("The gameplay WebSocket is not connected.");
  }

  socket.send(JSON.stringify(message));
}

function sendTransportMessage(transport, transportData = {}) {
  sendMessage({
    transport,
    transport_data: transportData,
  });
}

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

export function connectWebSocket({
  gameId,
  websocketUrl = DEFAULT_WEBSOCKET_URL,
}) {
  if (!responseHandler) {
    throw new Error("WebSocket module has not been initialized.");
  }

  if (!gameId) {
    throw new Error(
      "connectWebSocket requires gameId.",
    );
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

        await handleServerMessage(JSON.parse(text));
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

export function sendCommand(
  playerId,
  command,
  commandData = {},
) {
  if (!playerId) {
    throw new Error(
      "sendCommand requires the acting player ID.",
    );
  }

  sendMessage({
    player_id: playerId,
    command,
    command_data: commandData,
  });
}

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

export function isWebSocketConnected() {
  return socket?.readyState === WebSocket.OPEN;
}
