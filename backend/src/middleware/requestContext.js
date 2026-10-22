const {randomUUID} = require("crypto");
const {logger} = require("../services/observability.service");
const {metricsStore} = require("../services/metrics.service");
const {alertManager} = require("../services/alert.service");

const SAFE_ID = /^[a-zA-Z0-9._:-]{8,128}$/;

function safeHeaderId(value) {
  const normalized = String(value || "").trim();
  return SAFE_ID.test(normalized) ? normalized : null;
}

function requestContext(req, res, next) {
  const startedAt = Date.now();
  req.id = safeHeaderId(req.header("x-request-id")) || randomUUID();
  req.correlationId = safeHeaderId(req.header("x-correlation-id")) || req.id;
  res.setHeader("x-request-id", req.id);
  res.setHeader("x-correlation-id", req.correlationId);

  res.on("finish", () => {
    if (!req.path.startsWith("/api")) return;
    const event = {
      eventType: "HTTP_REQUEST_COMPLETED",
      module: "http",
      requestId: req.id,
      correlationId: req.correlationId,
      method: req.method,
      route: (req.route?.path ? `${req.baseUrl || ""}${req.route.path}` : req.path).slice(0, 300),
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id || null,
    };
    metricsStore.recordRequest(event);
    alertManager.observeRequest(event);
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("Solicitud HTTP completada", event);
  });
  next();
}

module.exports = requestContext;
