const {metricsStore, CircularBuffer} = require("./metrics.service");

class AlertManager {
  constructor(options = {}) {
    this.cooldownMs = options.cooldownMs || Number(process.env.ALERT_DEDUP_WINDOW_MS || 300000);
    this.alerts = new CircularBuffer(options.capacity || 500);
    this.lastTriggered = new Map();
    this.ticketFailures = [];
    this.clientErrors = [];
  }

  trigger(alert) {
    const now = Date.now();
    const key = alert.dedupeKey || `${alert.type}:${alert.service || "backend"}`;
    const previous = this.lastTriggered.get(key);
    if (previous && now - previous < this.cooldownMs) return false;
    this.lastTriggered.set(key, now);

    const normalized = {
      id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date(now).toISOString(),
      severity: alert.severity || "WARN",
      service: alert.service || "ticket-automation-backend",
      type: alert.type,
      summary: String(alert.summary || alert.type).slice(0, 300),
      requestId: alert.requestId || null,
      correlationId: alert.correlationId || alert.requestId || null,
      ticketId: alert.ticketId || null,
      module: alert.module || null,
    };
    this.alerts.add(normalized);
    metricsStore.recordStructuredEvent({...normalized, level: normalized.severity, eventType: "ALERT_TRIGGERED", message: normalized.summary});
    return true;
  }

  observeRequest(event) {
    const latencyThreshold = Number(process.env.ALERT_LATENCY_MS || 2000);
    if (event.statusCode >= 500) {
      this.trigger({
        type: "HTTP_5XX",
        severity: "ERROR",
        summary: `${event.method} ${event.route} respondio ${event.statusCode}`,
        requestId: event.requestId,
        correlationId: event.correlationId,
        module: "http",
        dedupeKey: `HTTP_5XX:${event.method}:${event.route}:${event.statusCode}`,
      });
    }
    if (event.durationMs >= latencyThreshold) {
      this.trigger({
        type: "HIGH_LATENCY",
        severity: "WARN",
        summary: `${event.method} ${event.route} tardo ${event.durationMs} ms`,
        requestId: event.requestId,
        correlationId: event.correlationId,
        module: "http",
        dedupeKey: `HIGH_LATENCY:${event.method}:${event.route}`,
      });
    }

    if (event.statusCode >= 400 && event.statusCode < 500) {
      const now = Date.now();
      const windowMs = Number(process.env.ALERT_4XX_WINDOW_MS || 300000);
      const threshold = Number(process.env.ALERT_4XX_THRESHOLD || 20);
      this.clientErrors.push(now);
      this.clientErrors = this.clientErrors.filter((value) => now - value <= windowMs);
      if (this.clientErrors.length >= threshold) {
        this.trigger({
          type: "ELEVATED_HTTP_4XX",
          severity: "WARN",
          summary: `${this.clientErrors.length} respuestas 4xx dentro del periodo configurado`,
          requestId: event.requestId,
          correlationId: event.correlationId,
          module: "http",
        });
      }
    }

    if (event.method === "POST" && event.route === "/api/tickets/submit" && event.statusCode >= 400) {
      const now = Date.now();
      const windowMs = Number(process.env.ALERT_TICKET_FAILURE_WINDOW_MS || 300000);
      const threshold = Number(process.env.ALERT_TICKET_FAILURE_THRESHOLD || 3);
      this.ticketFailures.push(now);
      this.ticketFailures = this.ticketFailures.filter((value) => now - value <= windowMs);
      if (this.ticketFailures.length >= threshold) {
        this.trigger({
          type: "REPEATED_TICKET_SUBMISSION_FAILURES",
          severity: "ERROR",
          summary: `${this.ticketFailures.length} envios de ticket fallaron dentro del periodo configurado`,
          requestId: event.requestId,
          correlationId: event.correlationId,
          module: "tickets",
        });
      }
    }
  }

  list({page = 1, pageSize = 25, severity, type} = {}) {
    let items = this.alerts.getAll().slice().reverse();
    if (severity) items = items.filter((item) => item.severity === severity);
    if (type) items = items.filter((item) => item.type === type);
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const start = (safePage - 1) * safePageSize;
    return {
      alerts: items.slice(start, start + safePageSize),
      pagination: {page: safePage, pageSize: safePageSize, total: items.length, hasNext: start + safePageSize < items.length},
    };
  }
}

const alertManager = new AlertManager();

module.exports = {AlertManager, alertManager};
