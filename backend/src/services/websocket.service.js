/**
 * @fileoverview WebSocket handler for real-time metrics and logging.
 * Manages client connections, broadcasts metrics every 5 seconds,
 * and provides graceful reconnection support for clients.
 */

const {metricsStore} = require("./metrics.service");
const {admin, db} = require("../config/firebase");
const {SUPERADMIN_EMAIL} = require("../middleware/authorization");
const {logger} = require("./observability.service");

/**
 * Container for all active WebSocket connections.
 * @type {Set<WebSocket>}
 */
const activeConnections = new Set();

/**
 * Validate Firebase token and return user info.
 * Returns null if token is invalid.
 */
async function validateWsToken(token) {
  if (!token) return null;

  if (token.startsWith("dev_token_")) {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_TOKENS !== "true") {
      return null;
    }
    return {id: "dev-user", email: "dev@localhost", role: "admin", expiresAt: Date.now() + 60 * 60 * 1000};
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token, true);
    const email = (decoded.email || "").toLowerCase().trim();
    let role = SUPERADMIN_EMAIL && email === SUPERADMIN_EMAIL ? "superadmin" : null;
    if (!role) {
      const snapshot = await db.collection("usuarios").where("email", "==", email).limit(1).get();
      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        role = data.rol || data.role || "usuario";
      }
    }
    if (!["admin", "superadmin"].includes(role)) return null;
    return {
      id: decoded.uid,
      email,
      role,
      expiresAt: decoded.exp ? Number(decoded.exp) * 1000 : Date.now() + 60 * 60 * 1000,
    };
  } catch {
    return null;
  }
}

/**
 * Initialize WebSocket server on Express HTTP server.
 * Upgrades HTTP to WebSocket protocol for /api/metrics endpoint.
 *
 * @param {http.Server} server - Express HTTP server instance
 * @param {Object} WebSocket - ws library class
 * @returns {Object} WebSocket server instance
 *
 * @example
 * const WebSocket = require('ws');
 * const wss = initMetricsWebSocket(server, WebSocket);
 */
function initMetricsWebSocket(server, WebSocket) {
  const wss = new WebSocket.Server({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });

  /**
   * Handle HTTP upgrade request for WebSocket connection.
   * Only accepts authenticated requests.
   */
  server.on("upgrade", async (request, socket, head) => {
    if (request.url !== "/api/metrics") {
      socket.destroy();
      return;
    }

    const authHeader = request.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const wsUser = await validateWsToken(token);

    if (!wsUser) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    request.wsUser = wsUser;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  /**
   * Handle new WebSocket connection.
   */
  wss.on("connection", (ws, request) => {
    const wsUser = request.wsUser || {id: "unknown"};
    logger.info("Cliente WebSocket conectado", {
      eventType: "WEBSOCKET_CONNECTED",
      module: "websocket",
      metadata: {user: wsUser.email || wsUser.id},
    });
    activeConnections.add(ws);

    const maximumSessionMs = 60 * 60 * 1000;
    const remainingTokenMs = wsUser.expiresAt ? wsUser.expiresAt - Date.now() : maximumSessionMs;
    const sessionTimer = setTimeout(() => {
      ws.close(4001, "Authentication expired");
    }, Math.max(1, Math.min(maximumSessionMs, remainingTokenMs)));
    sessionTimer.unref?.();

    const userId = wsUser.id;
    metricsStore.registerSession(ws, userId);

    // Send initial snapshot
    ws.send(
      JSON.stringify({
        type: "init",
        timestamp: new Date().toISOString(),
        metrics: metricsStore.getSnapshot(),
        logs: metricsStore.getRecentEvents(50),
      })
    );

    /**
     * Handle incoming messages from client.
     * Clients can request specific data or adjust filters.
     */
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data);

        if (message.type === "filter_logs") {
          // Client requests logs filtered by severity
          const severity = message.severity || null; // null = all
          const count = Math.min(message.count || 50, 200); // cap at 200
          ws.send(
            JSON.stringify({
              type: "logs",
              severity,
              logs: metricsStore.getRecentEvents(count, severity),
            })
          );
        }
      } catch (err) {
        console.error("[WebSocket] Error processing message:", err.message);
      }
    });

    /**
     * Handle connection close.
     */
    ws.on("close", () => {
      clearTimeout(sessionTimer);
      logger.info("Cliente WebSocket desconectado", {
        eventType: "WEBSOCKET_DISCONNECTED",
        module: "websocket",
      });
      activeConnections.delete(ws);
      metricsStore.unregisterSession(userId);
    });

    /**
     * Handle connection errors.
     */
    ws.on("error", (err) => {
      logger.warn("Error de WebSocket", {eventType: "WEBSOCKET_ERROR", module: "websocket"}, err);
    });
  });

  return wss;
}

/**
 * Start broadcasting metrics to all connected clients.
 * Sends aggregated metrics every 5 seconds.
 *
 * @param {number} [intervalMs=5000] - Broadcast interval in milliseconds
 * @returns {NodeJS.Timer} - Interval ID (can be cleared with clearInterval)
 */
function startMetricsBroadcast(intervalMs = 5000) {
  return setInterval(() => {
    const metrics = metricsStore.getSnapshot();
    const recentLogs = metricsStore.getRecentEvents(10); // Latest 10 events

    const payload = JSON.stringify({
      type: "metrics_update",
      timestamp: new Date().toISOString(),
      metrics,
      recentEvents: recentLogs,
    });

    let disconnected = 0;
    activeConnections.forEach((ws) => {
      if (ws.readyState === 1) {
        // WebSocket.OPEN
        ws.send(payload);
      } else {
        activeConnections.delete(ws);
        disconnected++;
      }
    });

    if (disconnected > 0 && activeConnections.size > 0) {
      console.log(
        `[Metrics] Broadcast to ${activeConnections.size} clients, cleaned up ${disconnected} stale connections`
      );
    }
  }, intervalMs);
}

/**
 * Gracefully shut down WebSocket server and broadcast loop.
 *
 * @param {Object} wss - WebSocket server instance
 * @param {NodeJS.Timer} broadcastInterval - Interval ID from startMetricsBroadcast
 */
function shutdownMetricsWebSocket(wss, broadcastInterval) {
  clearInterval(broadcastInterval);

  activeConnections.forEach((ws) => {
    ws.close(1000, "Server shutting down");
  });
  activeConnections.clear();

  wss.close(() => {
    console.log("[WebSocket] Server shut down gracefully");
  });
}

/**
 * Send an event to all connected clients (for notifications).
 * Used for non-periodic updates like alerts or important system events.
 *
 * @param {string} eventType
 * @param {Object} data
 */
function broadcastEvent(eventType, data = {}) {
  const payload = JSON.stringify({
    type: "event",
    eventType,
    timestamp: new Date().toISOString(),
    data,
  });

  activeConnections.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  });
}

module.exports = {
  initMetricsWebSocket,
  startMetricsBroadcast,
  shutdownMetricsWebSocket,
  broadcastEvent,
  activeConnections,
};
