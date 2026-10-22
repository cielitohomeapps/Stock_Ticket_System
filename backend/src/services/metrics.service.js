class CircularBuffer {
  constructor(size = 2000) {
    this.size = size;
    this.buffer = [];
    this.index = 0;
  }

  add(entry) {
    if (this.buffer.length < this.size) this.buffer.push(entry);
    else {
      this.buffer[this.index] = entry;
      this.index = (this.index + 1) % this.size;
    }
  }

  getAll() {
    if (this.buffer.length < this.size) return [...this.buffer];
    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }

  getLast(count) {
    const all = this.getAll();
    return all.slice(Math.max(0, all.length - count));
  }
}

class LatencyHistogram {
  constructor(windowSize = 1000) {
    this.windowSize = windowSize;
    this.samples = [];
  }

  add(ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.windowSize) this.samples = this.samples.slice(-this.windowSize);
  }

  percentile(percentile) {
    if (!this.samples.length) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
    return sorted[index];
  }

  average() {
    if (!this.samples.length) return 0;
    return Math.round(this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length);
  }
}

class MetricsStore {
  constructor(options = {}) {
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.requestsByStatus = {};
    this.requestsByEndpoint = new Map();
    this.activeSessions = new Map();
    this.latencyHistogram = new LatencyHistogram(options.latencyWindow || 1000);
    this.eventLog = new CircularBuffer(options.eventCapacity || Number(process.env.MONITORING_LOG_CAPACITY || 2000));
    this.requestWindow = [];
    this.errorWindow = [];
    this.cleanupInterval = null;
    if (options.startCleanup !== false) this._startSessionCleanup();
  }

  recordRequest(input, durationMs, userId = null) {
    const event = typeof input === "object"
      ? input
      : {statusCode: Number(input), durationMs: Number(durationMs), userId};
    const statusCode = Number(event.statusCode || 0);
    const latency = Number(event.durationMs || 0);
    const now = Date.now();
    const routeKey = `${event.method || "?"} ${event.route || "unknown"}`;

    this.totalRequests += 1;
    this.requestsByStatus[statusCode] = (this.requestsByStatus[statusCode] || 0) + 1;
    this.latencyHistogram.add(latency);
    this.requestWindow.push(now);
    this.requestWindow = this.requestWindow.filter((value) => now - value < 60000);

    const endpoint = this.requestsByEndpoint.get(routeKey) || {requests: 0, errors: 0, totalDurationMs: 0, maxDurationMs: 0};
    endpoint.requests += 1;
    endpoint.totalDurationMs += latency;
    endpoint.maxDurationMs = Math.max(endpoint.maxDurationMs, latency);
    if (statusCode >= 400) {
      this.totalErrors += 1;
      endpoint.errors += 1;
      this.errorWindow.push(now);
      this.errorWindow = this.errorWindow.filter((value) => now - value < 60000);
    }
    this.requestsByEndpoint.set(routeKey, endpoint);

    if (event.userId) {
      this.activeSessions.set(event.userId, {
        connectedAt: this.activeSessions.get(event.userId)?.connectedAt || now,
        lastActivity: now,
      });
    }
  }

  recordStructuredEvent(event = {}) {
    this.eventLog.add({
      timestamp: event.timestamp || new Date().toISOString(),
      level: String(event.level || event.severity || "INFO").toUpperCase(),
      severity: String(event.level || event.severity || "INFO").toLowerCase(),
      service: event.service || "ticket-automation-backend",
      environment: event.environment || process.env.NODE_ENV || "development",
      module: event.module || "application",
      eventType: event.eventType || "APPLICATION_EVENT",
      message: event.message || event.eventType || "Evento",
      requestId: event.requestId || null,
      correlationId: event.correlationId || event.requestId || null,
      route: event.route || null,
      method: event.method || null,
      statusCode: event.statusCode ?? null,
      durationMs: event.durationMs ?? null,
      errorType: event.errorType || null,
      stack: event.stack || null,
      ticketId: event.ticketId || null,
      metadata: event.metadata || null,
    });
  }

  recordEvent(eventType, severity = "info", message = null, metadata = {}) {
    this.recordStructuredEvent({
      eventType,
      level: String(severity).toUpperCase(),
      message: message || eventType,
      ticketId: metadata.ticketId,
      requestId: metadata.requestId,
      correlationId: metadata.correlationId,
      module: metadata.module || "tickets",
      metadata,
    });
  }

  getSnapshot() {
    const now = Date.now();
    this.requestWindow = this.requestWindow.filter((value) => now - value < 60000);
    this.errorWindow = this.errorWindow.filter((value) => now - value < 60000);
    const endpoints = [...this.requestsByEndpoint.entries()].map(([route, stats]) => ({
      route,
      requests: stats.requests,
      errors: stats.errors,
      errorRate: stats.requests ? Number((stats.errors / stats.requests).toFixed(4)) : 0,
      averageLatencyMs: stats.requests ? Math.round(stats.totalDurationMs / stats.requests) : 0,
      maxLatencyMs: stats.maxDurationMs,
    })).sort((a, b) => b.errorRate - a.errorRate || b.requests - a.requests).slice(0, 20);

    const recentErrorRatio = this.requestWindow.length ? this.errorWindow.length / this.requestWindow.length : 0;
    const latencyP95 = this.latencyHistogram.percentile(95);
    const errorWarn = Number(process.env.MONITORING_ERROR_RATE_WARN || 0.05);
    const errorCritical = Number(process.env.MONITORING_ERROR_RATE_CRITICAL || 0.2);
    const latencyWarn = Number(process.env.MONITORING_LATENCY_WARN_MS || 1000);
    const latencyCritical = Number(process.env.MONITORING_LATENCY_CRITICAL_MS || 3000);
    const status = recentErrorRatio >= errorCritical || latencyP95 >= latencyCritical
      ? "INCIDENT"
      : recentErrorRatio >= errorWarn || latencyP95 >= latencyWarn
        ? "DEGRADED"
        : "HEALTHY";

    return {
      status,
      requestsPerSec: Number((this.requestWindow.length / 60).toFixed(2)),
      errorsPerSec: Number((this.errorWindow.length / 60).toFixed(2)),
      recentErrorRate: Number(recentErrorRatio.toFixed(4)),
      activeUsers: this.activeSessions.size,
      latencyP95,
      latencyAvg: this.latencyHistogram.average(),
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      requestsByStatus: {...this.requestsByStatus},
      endpoints,
      thresholds: {errorWarn, errorCritical, latencyWarn, latencyCritical},
    };
  }

  getRecentEvents(count = 50, severity = null) {
    let events = this.eventLog.getLast(Math.min(500, Math.max(1, Number(count) || 50)));
    if (severity) events = events.filter((event) => event.level === String(severity).toUpperCase());
    return events;
  }

  queryEvents(filters = {}) {
    let events = this.eventLog.getAll().slice().reverse();
    const level = String(filters.level || "").toUpperCase();
    const search = String(filters.search || "").trim().toLowerCase();
    const fromMs = filters.from ? new Date(filters.from).getTime() : null;
    const toMs = filters.to ? new Date(filters.to).getTime() : null;
    if (level) events = events.filter((event) => event.level === level);
    if (filters.service) events = events.filter((event) => event.service === filters.service);
    if (filters.module) events = events.filter((event) => event.module === filters.module);
    if (filters.eventType) events = events.filter((event) => event.eventType === filters.eventType);
    if (filters.requestId) events = events.filter((event) => event.requestId === filters.requestId || event.correlationId === filters.requestId);
    if (filters.ticketId) events = events.filter((event) => event.ticketId === filters.ticketId);
    if (Number.isFinite(fromMs)) events = events.filter((event) => new Date(event.timestamp).getTime() >= fromMs);
    if (Number.isFinite(toMs)) events = events.filter((event) => new Date(event.timestamp).getTime() <= toMs);
    if (search) {
      events = events.filter((event) => [event.message, event.eventType, event.route, event.errorType]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(search)));
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 25));
    const start = (page - 1) * pageSize;
    return {
      logs: events.slice(start, start + pageSize),
      pagination: {page, pageSize, total: events.length, hasNext: start + pageSize < events.length},
    };
  }

  registerSession(_sessionId, userId) {
    const now = Date.now();
    this.activeSessions.set(userId, {connectedAt: now, lastActivity: now});
  }

  unregisterSession(userId) {
    this.activeSessions.delete(userId);
  }

  _startSessionCleanup() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [userId, session] of this.activeSessions.entries()) {
        if (now - session.lastActivity > 5 * 60 * 1000) this.activeSessions.delete(userId);
      }
    }, 60000);
    this.cleanupInterval.unref?.();
  }
}

const metricsStore = new MetricsStore();

module.exports = {metricsStore, MetricsStore, CircularBuffer, LatencyHistogram};
