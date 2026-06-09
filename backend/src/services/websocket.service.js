/**
 * @fileoverview WebSocket handler for real-time metrics and logging.
 * Manages client connections, broadcasts metrics every 5 seconds,
 * and provides graceful reconnection support for clients.
 */

const {metricsStore} = require("./metrics.service");

/**
 * Container for all active WebSocket connections.
 * @type {Set<WebSocket>}
 */
const activeConnections = new Set();

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
  });

  /**
   * Handle HTTP upgrade request for WebSocket connection.
   * Called by: server.on('upgrade', ...)
   */
  server.on("upgrade", (request, socket, head) => {
    if (request.url === "/api/metrics") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  /**
   * Handle new WebSocket connection.
   */
  wss.on("connection", (ws, request) => {
    console.log(
      "[WebSocket] Client connected from",
      request.socket.remoteAddress
    );
    activeConnections.add(ws);

    // Extract user ID from request headers (if authenticated)
    const authHeader = request.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const userId = token ? `user_${token.slice(0, 8)}` : `anon_${Math.random().toString(36).slice(2, 9)}`;

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
      console.log("[WebSocket] Client disconnected");
      activeConnections.delete(ws);
      metricsStore.unregisterSession(userId);
    });

    /**
     * Handle connection errors.
     */
    ws.on("error", (err) => {
      console.error("[WebSocket] Error:", err.message);
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
