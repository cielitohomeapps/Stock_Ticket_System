const {app} = require("./app");
const http = require("http");
const WebSocket = require("ws");
const {
  initMetricsWebSocket,
  startMetricsBroadcast,
} = require("./services/websocket.service");
const {startIntegrityMonitor} = require("./services/integrity-monitor.service");
const {logger} = require("./services/observability.service");

const PORT = Number(process.env.PORT || 3001);

// Create HTTP server (supports both HTTP and WebSocket upgrades)
const server = http.createServer(app);

const websocketEnabled = process.env.ENABLE_METRICS_WEBSOCKET === "true";
const wss = websocketEnabled ? initMetricsWebSocket(server, WebSocket) : null;
const broadcastInterval = websocketEnabled ? startMetricsBroadcast(5000) : null;
const integrityInterval = startIntegrityMonitor();

// ── Global error handlers ─────────────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  logger.fatal("Promesa rechazada sin manejo", {eventType: "UNHANDLED_REJECTION", module: "process"}, reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", (err) => {
  logger.fatal("Excepcion no controlada", {eventType: "UNCAUGHT_EXCEPTION", module: "process"}, err);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 10000).unref();
});

// Graceful shutdown handler
process.on("SIGTERM", () => {
  logger.info("SIGTERM recibido; iniciando apagado", {eventType: "PROCESS_SHUTDOWN", module: "process"});
  server.close(() => {
    if (broadcastInterval) clearInterval(broadcastInterval);
    if (integrityInterval) clearInterval(integrityInterval);
    if (wss) wss.close();
    process.exit(0);
  });
});

server.listen(PORT, () => {
  logger.info("Backend iniciado", {
    eventType: "PROCESS_STARTED",
    module: "process",
    metadata: {port: PORT, websocketEnabled},
  });
});
