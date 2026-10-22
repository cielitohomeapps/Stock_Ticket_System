const {ticketDb} = require("../config/firebase");
const {metricsStore} = require("../services/metrics.service");
const {alertManager} = require("../services/alert.service");
const {scanTicketIntegrity} = require("../services/integrity-monitor.service");

async function checkDatabase(timeoutMs = 3000) {
  const startedAt = Date.now();
  const operation = ticketDb.collection("tickets").limit(1).get();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("database_timeout")), timeoutMs);
  });
  try {
    await Promise.race([operation, timeout]);
    return {status: "UP", latencyMs: Date.now() - startedAt};
  } catch (error) {
    return {status: "DOWN", latencyMs: Date.now() - startedAt, errorType: error.message === "database_timeout" ? "TIMEOUT" : "CONNECTION_ERROR"};
  } finally {
    clearTimeout(timeoutId);
  }
}

const monitoringController = {
  summary: async (_req, res) => {
    const database = await checkDatabase();
    const metrics = metricsStore.getSnapshot();
    const status = database.status === "DOWN" ? "INCIDENT" : metrics.status;
    return res.json({
      status,
      generatedAt: new Date().toISOString(),
      metrics,
      dependencies: {database},
      latestAlerts: alertManager.list({pageSize: 10}).alerts,
    });
  },

  logs: (req, res) => res.json(metricsStore.queryEvents(req.query)),

  alerts: (req, res) => res.json(alertManager.list(req.query)),

  integrity: async (req, res, next) => {
    try {
      return res.json(await scanTicketIntegrity({limit: req.query.limit, emitEvents: false}));
    } catch (error) {
      return next(error);
    }
  },

  detailedHealth: async (_req, res) => {
    const database = await checkDatabase();
    const metrics = metricsStore.getSnapshot();
    const ok = database.status === "UP";
    return res.status(ok ? 200 : 503).json({
      ok,
      status: ok ? metrics.status : "INCIDENT",
      checkedAt: new Date().toISOString(),
      process: {status: "UP", uptimeSeconds: Math.floor(process.uptime())},
      database,
      ticketFlow: {status: metrics.status === "INCIDENT" ? "DEGRADED" : "UP"},
    });
  },
};

module.exports = {monitoringController, checkDatabase};
