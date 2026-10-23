const {metricsStore} = require("./metrics.service");

const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|token|private.?key|credit|card|cvv|content|description/i;

function maskEmail(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\b([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, (_match, name, domain) =>
    `${name.slice(0, 2)}***@${domain}`
  );
}

function sanitize(value, depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return maskEmail(value.slice(0, 1000));
  if (depth >= 5) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(child, depth + 1);
    }
    return output;
  }
  return String(value);
}

function emit(level, message, context = {}, error = null) {
  const normalizedLevel = String(level || "INFO").toUpperCase();
  const event = sanitize({
    timestamp: new Date().toISOString(),
    level: normalizedLevel,
    service: "ticket-automation-backend",
    environment: process.env.NODE_ENV || "development",
    message: String(message || "Evento sin mensaje").slice(0, 500),
    ...context,
    errorType: error?.name,
    errorCode: error?.code,
    errorMessage: error?.message,
    stack: error?.stack,
  });

  metricsStore.recordStructuredEvent(event);
  const serialized = JSON.stringify(event);
  if (normalizedLevel === "ERROR" || normalizedLevel === "FATAL") console.error(serialized);
  else if (normalizedLevel === "WARN") console.warn(serialized);
  else if (normalizedLevel === "DEBUG") console.debug(serialized);
  else console.info(serialized);
  return event;
}

const logger = {
  debug: (message, context) => emit("DEBUG", message, context),
  info: (message, context) => emit("INFO", message, context),
  warn: (message, context, error) => emit("WARN", message, context, error),
  error: (message, context, error) => emit("ERROR", message, context, error),
  fatal: (message, context, error) => emit("FATAL", message, context, error),
};

module.exports = {logger, sanitize, maskEmail};
