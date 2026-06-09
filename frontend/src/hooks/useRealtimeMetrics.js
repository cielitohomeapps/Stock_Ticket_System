/**
 * @fileoverview Custom React hook for real-time metrics via WebSocket.
 * Manages WebSocket lifecycle, reconnection logic, and provides fallback to polling.
 * 
 * @module useRealtimeMetrics
 */

import {useState, useEffect, useRef, useCallback} from 'react';

/**
 * Reconnection strategy configuration.
 * @typedef {Object} ReconnectConfig
 * @property {number} initialDelay - Initial retry delay in ms (default 1000)
 * @property {number} maxDelay - Maximum retry delay in ms (default 30000)
 * @property {number} multiplier - Exponential backoff multiplier (default 1.5)
 * @property {number} maxAttempts - Max connection attempts before giving up (default 10)
 */

const DEFAULT_RECONNECT_CONFIG = {
  initialDelay: 1000,
  maxDelay: 30000,
  multiplier: 1.5,
  maxAttempts: 10,
};

/**
 * Custom hook for subscribing to real-time metrics via WebSocket.
 * Provides automatic reconnection, fallback to polling, and graceful degradation.
 *
 * @param {Object} options - Hook configuration
 * @param {string} [options.url] - WebSocket URL (defaults to window.location derived)
 * @param {string} [options.token] - Authorization Bearer token for authentication
 * @param {Object} [options.reconnectConfig] - Custom reconnection strategy
 * @param {boolean} [options.enablePolling=true] - Enable 30s polling fallback if WS unavailable
 * @param {number} [options.pollingInterval=30000] - Polling interval in ms
 *
 * @returns {Object} Metrics object
 * @returns {Object} metrics.metrics - Current aggregated metrics
 * @returns {Array<Object>} metrics.logs - Recent log entries (with timestamp, severity, message)
 * @returns {boolean} metrics.isConnected - WebSocket connection status
 * @returns {string|null} metrics.connectionStatus - 'connected' | 'connecting' | 'disconnected'
 * @returns {string|null} metrics.error - Error message if any
 * @returns {Function} metrics.filterLogs - Function to request logs with severity filter
 * @returns {Function} metrics.disconnect - Manually disconnect from WebSocket
 * @returns {Function} metrics.reconnect - Manually trigger reconnection attempt
 *
 * @example
 * ```jsx
 * const {metrics, logs, isConnected, error} = useRealtimeMetrics({
 *   token: firebaseToken,
 *   enablePolling: true,
 * });
 *
 * if (error) {
 *   return <div>Error: {error}</div>;
 * }
 *
 * return (
 *   <div>
 *     Status: {isConnected ? '🟢 Live' : '🔴 Polling'}
 *     Requests/sec: {metrics.requestsPerSec}
 *     Errors/sec: {metrics.errorsPerSec}
 *   </div>
 * );
 * ```
 */
export function useRealtimeMetrics(options = {}) {
  const {
    url = null,
    token = null,
    reconnectConfig = {},
    enablePolling = true,
    pollingInterval = 30000,
  } = options;

  const reconnectConfigMerged = {...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig};

  // State management
  const [metrics, setMetrics] = useState({
    requestsPerSec: 0,
    errorsPerSec: 0,
    activeUsers: 0,
    latencyP95: 0,
    latencyAvg: 0,
    totalRequests: 0,
    totalErrors: 0,
    requestsByStatus: {},
  });

  const [logs, setLogs] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [error, setError] = useState(null);

  // Refs for WebSocket and timers
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const shouldAttemptReconnectRef = useRef(true);
  const pendingMessageRef = useRef({});

  /**
   * Build WebSocket URL from window.location if not provided.
   * Converts http/https to ws/wss.
   */
  const getWebSocketUrl = useCallback(() => {
    if (url) return url;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/api/metrics`;
  }, [url]);

  /**
   * Construct headers for WebSocket upgrade request.
   * Includes Authorization header for authentication.
   */
  const getHeaders = useCallback(() => {
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  /**
   * Establish WebSocket connection with retry logic.
   * Exponential backoff on failure, max attempts limit.
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === 1) {
      // Already connected
      return;
    }

    setConnectionStatus('connecting');

    try {
      const wsUrl = getWebSocketUrl();

      // Note: Standard WebSocket doesn't support custom headers directly.
      // For token-based auth in production, consider:
      // 1. Including token in URL query: ?token=xxxxx
      // 2. Using subprotocol negotiation
      // 3. Using a dedicated auth endpoint before WS connection
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[useRealtimeMetrics] WebSocket connected');
        setIsConnected(true);
        setConnectionStatus('connected');
        setError(null);
        reconnectAttemptsRef.current = 0;

        // Send auth message if token provided
        if (token) {
          ws.send(
            JSON.stringify({
              type: 'auth',
              token,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'init' || message.type === 'metrics_update') {
            if (message.metrics) {
              setMetrics(message.metrics);
            }
            if (message.logs) {
              setLogs(message.logs);
            }
            if (message.recentEvents) {
              setLogs((prev) =>
                [...message.recentEvents, ...prev].slice(0, 100)
              );
            }
          } else if (message.type === 'logs') {
            if (message.logs) {
              setLogs(message.logs);
            }
          } else if (message.type === 'event') {
            // Broadcast event notification (e.g., alerts)
            console.log('[useRealtimeMetrics] Event received:', message.eventType);
          }

          // Process any pending messages
          if (pendingMessageRef.current.type) {
            ws.send(JSON.stringify(pendingMessageRef.current));
            pendingMessageRef.current = {};
          }
        } catch (err) {
          console.error('[useRealtimeMetrics] Error parsing message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('[useRealtimeMetrics] WebSocket error:', event);
        setError('WebSocket connection error');
      };

      ws.onclose = () => {
        console.log('[useRealtimeMetrics] WebSocket disconnected');
        setIsConnected(false);
        setConnectionStatus('disconnected');
        wsRef.current = null;

        // Attempt reconnection if still supposed to
        if (
          shouldAttemptReconnectRef.current &&
          reconnectAttemptsRef.current < reconnectConfigMerged.maxAttempts
        ) {
          reconnectAttemptsRef.current++;
          const delayMs = Math.min(
            reconnectConfigMerged.initialDelay *
              Math.pow(
                reconnectConfigMerged.multiplier,
                reconnectAttemptsRef.current - 1
              ),
            reconnectConfigMerged.maxDelay
          );

          console.log(
            `[useRealtimeMetrics] Reconnecting in ${delayMs}ms (attempt ${reconnectAttemptsRef.current})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delayMs);
        } else if (reconnectAttemptsRef.current >= reconnectConfigMerged.maxAttempts) {
          setError(
            'WebSocket connection failed. Falling back to polling.'
          );
          // Start polling fallback
          startPolling();
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[useRealtimeMetrics] Connection error:', err);
      setError(err.message);
      setConnectionStatus('disconnected');

      // Fallback to polling
      if (enablePolling) {
        startPolling();
      }
    }
  }, [getWebSocketUrl, token, enablePolling, reconnectConfigMerged]);

  /**
   * Start polling fallback (30s interval).
   * Fetches metrics from /api/metrics endpoint.
   */
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      return; // Already polling
    }

    console.log('[useRealtimeMetrics] Starting polling fallback');
    setConnectionStatus('polling');

    const poll = async () => {
      try {
        const headers = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/metrics/snapshot', {
          headers,
        }).catch(() => null);

        if (res && res.ok) {
          const data = await res.json();
          setMetrics(data.metrics);
          setLogs(data.logs || []);
          setError(null);
        }
      } catch (err) {
        console.error('[useRealtimeMetrics] Polling error:', err.message);
      }
    };

    poll();
    pollingIntervalRef.current = setInterval(poll, pollingInterval);
  }, [token, pollingInterval, enablePolling]);

  /**
   * Stop polling fallback.
   */
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      console.log('[useRealtimeMetrics] Polling stopped');
    }
  }, []);

  /**
   * Manually disconnect WebSocket and stop polling.
   */
  const disconnect = useCallback(() => {
    console.log('[useRealtimeMetrics] Manually disconnecting');
    shouldAttemptReconnectRef.current = false;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    stopPolling();
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, [stopPolling]);

  /**
   * Manually trigger reconnection attempt.
   */
  const reconnect = useCallback(() => {
    console.log('[useRealtimeMetrics] Manual reconnection requested');
    shouldAttemptReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    stopPolling();
    connect();
  }, [connect, stopPolling]);

  /**
   * Request filtered logs from server.
   * Sends a message to the WebSocket server requesting specific severity.
   */
  const filterLogs = useCallback((severity = null, count = 50) => {
    const message = {
      type: 'filter_logs',
      severity,
      count,
    };

    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      // Queue message for after connection
      pendingMessageRef.current = message;
    }
  }, []);

  /**
   * Effect: Initialize connection on mount, cleanup on unmount.
   */
  useEffect(() => {
    shouldAttemptReconnectRef.current = true;
    connect();

    return () => {
      shouldAttemptReconnectRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      stopPolling();
    };
  }, [connect, stopPolling]);

  /**
   * Effect: Update token (e.g., after auth token refresh).
   * Reconnects with new token.
   */
  useEffect(() => {
    if (token && isConnected) {
      // Re-authenticate on token change
      if (wsRef.current?.readyState === 1) {
        wsRef.current.send(
          JSON.stringify({
            type: 'auth',
            token,
          })
        );
      }
    }
  }, [token, isConnected]);

  return {
    metrics,
    logs,
    isConnected,
    connectionStatus,
    error,
    filterLogs,
    disconnect,
    reconnect,
  };
}

export default useRealtimeMetrics;
