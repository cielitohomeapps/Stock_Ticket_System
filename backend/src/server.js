const {app} = require("./app");
const http = require("http");
const WebSocket = require("ws");
const {
  initMetricsWebSocket,
  startMetricsBroadcast,
} = require("./services/websocket.service");

const PORT = Number(process.env.PORT || 3001);

// Create HTTP server (supports both HTTP and WebSocket upgrades)
const server = http.createServer(app);

// Initialize WebSocket server for metrics endpoint
const wss = initMetricsWebSocket(server, WebSocket);

// Start broadcasting metrics to all connected clients
const broadcastInterval = startMetricsBroadcast(5000);

// Graceful shutdown handler
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    clearInterval(broadcastInterval);
    wss.close();
    process.exit(0);
  });
});

server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`WebSocket metrics available at ws://localhost:${PORT}/api/metrics`);
});
