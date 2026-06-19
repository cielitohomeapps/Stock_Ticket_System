/**
 * @fileoverview Centralized metrics collection and aggregation service.
 * Tracks request metrics, error rates, active sessions, and latency histograms.
 * Thread-safe for high-frequency updates.
 */

/**
 * Circular buffer implementation for fixed-size log storage.
 * Automatically overwrites oldest entries when full.
 * @template T
 */
class CircularBuffer {
  /**
   * @param {number} size - Maximum number of entries
   */
  constructor(size = 1000) {
    this.size = size;
    this.buffer = [];
    this.index = 0;
  }

  /**
   * Add an entry to the buffer.
   * @param {T} entry
   */
  add(entry) {
    if (this.buffer.length < this.size) {
      this.buffer.push(entry);
    } else {
      this.buffer[this.index] = entry;
      this.index = (this.index + 1) % this.size;
    }
  }

  /**
   * Get all entries in insertion order.
   * @returns {T[]}
   */
  getAll() {
    if (this.buffer.length < this.size) {
      return [...this.buffer];
    }
    // Reconstruct order when buffer has wrapped
    return [
      ...this.buffer.slice(this.index),
      ...this.buffer.slice(0, this.index),
    ];
  }

  /**
   * Get last N entries.
   * @param {number} n
   * @returns {T[]}
   */
  getLast(n) {
    const all = this.getAll();
    return all.slice(Math.max(0, all.length - n));
  }
}

/**
 * Histogram for percentile calculation (simple, fixed-size version).
 * Maintains buckets for latency analysis.
 */
class LatencyHistogram {
  constructor(windowSize = 300) {
    this.windowSize = windowSize;
    this.samples = [];
  }

  /**
   * Add a latency sample (in milliseconds).
   * @param {number} ms
   */
  add(ms) {
    this.samples.push(ms);
    // Keep only recent samples
    if (this.samples.length > this.windowSize) {
      this.samples = this.samples.slice(-this.windowSize);
    }
  }

  /**
   * Calculate percentile.
   * @param {number} percentile - 0-100
   * @returns {number}
   */
  percentile(percentile) {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  /**
   * Get average latency.
   * @returns {number}
   */
  average() {
    if (this.samples.length === 0) return 0;
    const sum = this.samples.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.samples.length);
  }
}

/**
 * Global metrics store. Singleton instance shared across request handlers.
 */
class MetricsStore {
  constructor() {
    // Request counters
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.requestsByStatus = {}; // e.g., { "200": 150, "404": 5, "500": 2 }

    // Active sessions
    this.activeSessions = new Map(); // userId -> { connectedAt, lastActivity }

    // Latency tracking
    this.latencyHistogram = new LatencyHistogram(300);

    // Event log (circular buffer)
    this.eventLog = new CircularBuffer(1000);

    // 30-second rolling window for request rate
    this.requestWindow = [];
    this.errorWindow = [];

    // Start cleanup interval for stale sessions
    this._startSessionCleanup();
  }

  /**
   * Record a request.
   * @param {number} statusCode
   * @param {number} durationMs
   * @param {string} [userId]
   */
  recordRequest(statusCode, durationMs, userId = null) {
    this.totalRequests++;
    this.requestsByStatus[statusCode] =
      (this.requestsByStatus[statusCode] || 0) + 1;
    this.latencyHistogram.add(durationMs);

    const now = Date.now();
    this.requestWindow.push(now);
    // Keep only last 30 seconds
    this.requestWindow = this.requestWindow.filter((t) => now - t < 30000);

    if (statusCode >= 400) {
      this.totalErrors++;
      this.errorWindow.push(now);
      this.errorWindow = this.errorWindow.filter((t) => now - t < 30000);
    }

    if (userId) {
      this.activeSessions.set(userId, {
        connectedAt: this.activeSessions.get(userId)?.connectedAt || now,
        lastActivity: now,
      });
    }
  }

  /**
   * Record a business event (ticket created, user action, etc).
   * @param {string} eventType - e.g., "TICKET_CREATED", "USER_LOGIN"
   * @param {string} severity - "info" | "warn" | "error"
   * @param {string} [message]
   * @param {Object} [metadata]
   */
  recordEvent(eventType, severity = "info", message = null, metadata = {}) {
    this.eventLog.add({
      timestamp: new Date().toISOString(),
      eventType,
      severity,
      message: message || eventType,
      metadata,
    });
  }

  /**
   * Get current metrics snapshot.
   * @returns {Object}
   */
  getSnapshot() {
    const now = Date.now();
    const requestRate = this.requestWindow.length / 30; // per second
    const errorRate = this.errorWindow.length / 30; // per second

    return {
      requestsPerSec: Math.round(requestRate * 100) / 100,
      errorsPerSec: Math.round(errorRate * 100) / 100,
      activeUsers: this.activeSessions.size,
      latencyP95: this.latencyHistogram.percentile(95),
      latencyAvg: this.latencyHistogram.average(),
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      requestsByStatus: this.requestsByStatus,
    };
  }

  /**
   * Get recent events (for log streaming).
   * @param {number} [count=50]
   * @param {string} [severity] - filter by severity (optional)
   * @returns {Array}
   */
  getRecentEvents(count = 50, severity = null) {
    let events = this.eventLog.getLast(count);
    if (severity) {
      events = events.filter((e) => e.severity === severity);
    }
    return events;
  }

  /**
   * Register a WebSocket session.
   * @param {string} sessionId
   * @param {string} userId
   */
  registerSession(sessionId, userId) {
    const now = Date.now();
    this.activeSessions.set(userId, {
      connectedAt: now,
      lastActivity: now,
    });
  }

  /**
   * Unregister a WebSocket session.
   * @param {string} userId
   */
  unregisterSession(userId) {
    this.activeSessions.delete(userId);
  }

  /**
   * Clean up stale sessions (no activity > 5 minutes).
   * @private
   */
  _startSessionCleanup() {
    setInterval(() => {
      const now = Date.now();
      const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

      for (const [userId, session] of this.activeSessions.entries()) {
        if (now - session.lastActivity > STALE_THRESHOLD) {
          this.activeSessions.delete(userId);
        }
      }
    }, 60000); // Check every minute
  }
}

/**
 * Singleton instance of the metrics store.
 * @type {MetricsStore}
 */
const metricsStore = new MetricsStore();

module.exports = {
  metricsStore,
  MetricsStore,
  CircularBuffer,
  LatencyHistogram,
};
