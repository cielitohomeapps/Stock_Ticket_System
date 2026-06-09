/**
 * @fileoverview Real-time monitoring dashboard for ticket automation system.
 * Displays metrics, logs, and alerts with live WebSocket updates.
 */

import React, {useState, useEffect} from 'react';
import {useRealtimeMetrics} from '../hooks/useRealtimeMetrics';
import {MetricCard} from './MetricCard';
import {LogViewer} from './LogViewer';
import {TimeSeriesChart} from './TimeSeriesChart';
import '../styles/Dashboard.css';

/**
 * Real-time monitoring dashboard component.
 * Shows system metrics, logs, and alerts updated in real-time via WebSocket.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.firebaseToken] - Firebase auth token for authenticated requests
 * @param {string} [props.userRole] - User role for permission-based features
 * @returns {JSX.Element}
 *
 * @example
 * ```jsx
 * function App() {
 *   const [firebaseToken, setFirebaseToken] = useState(null);
 *   
 *   return (
 *     <Dashboard firebaseToken={firebaseToken} />
 *   );
 * }
 * ```
 */
export function Dashboard({firebaseToken = null, userRole = null}) {
  const {
    metrics,
    logs,
    isConnected,
    connectionStatus,
    error,
    filterLogs,
    reconnect,
  } = useRealtimeMetrics({
    token: firebaseToken,
    enablePolling: true,
    pollingInterval: 30000,
  });

  const [previousMetrics, setPreviousMetrics] = useState(null);

  // Update previous metrics for trend calculation
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviousMetrics(metrics);
    }, 5000);

    return () => clearTimeout(timer);
  }, [metrics]);

  /**
   * Determine metric card status based on thresholds.
   */
  const getMetricStatus = (metric, value) => {
    switch (metric) {
      case 'errorsPerSec':
        if (value > 1) return 'critical';
        if (value > 0.5) return 'warning';
        return 'good';
      case 'latencyP95':
        if (value > 500) return 'critical';
        if (value > 200) return 'warning';
        return 'good';
      case 'activeUsers':
        return 'neutral';
      default:
        return 'neutral';
    }
  };

  /**
   * Get connection status icon and text.
   */
  const getConnectionDisplay = () => {
    if (isConnected) {
      return {
        icon: '🟢',
        text: 'Connected (WebSocket)',
        className: 'dashboard__connection--active',
      };
    }
    if (connectionStatus === 'polling') {
      return {
        icon: '🟡',
        text: 'Polling (30s interval)',
        className: 'dashboard__connection--polling',
      };
    }
    return {
      icon: '🔴',
      text: 'Disconnected',
      className: 'dashboard__connection--inactive',
    };
  };

  const connectionDisplay = getConnectionDisplay();

  return (
    <div className="dashboard">
      {/* Header */}
      <div className="dashboard__header">
        <div className="dashboard__header-content">
          <h1 className="dashboard__title">📊 Real-Time Monitoring Dashboard</h1>
          <p className="dashboard__subtitle">System metrics and event logs</p>
        </div>

        <div className="dashboard__header-actions">
          <div className={`dashboard__connection ${connectionDisplay.className}`}>
            <span className="dashboard__connection-icon">
              {connectionDisplay.icon}
            </span>
            <span className="dashboard__connection-text">
              {connectionDisplay.text}
            </span>
            {!isConnected && (
              <button
                className="dashboard__button dashboard__button--secondary"
                onClick={reconnect}
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="dashboard__error-banner">
          <div className="dashboard__error-content">
            <span className="dashboard__error-icon">⚠️</span>
            <span className="dashboard__error-text">{error}</span>
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="dashboard__metrics">
        <h2 className="dashboard__section-title">Key Metrics</h2>
        <div className="dashboard__metrics-grid">
          <MetricCard
            title="Requests/sec"
            value={metrics.requestsPerSec}
            unit="/s"
            previousValue={previousMetrics?.requestsPerSec}
            icon="📈"
            status="good"
          />
          <MetricCard
            title="Errors/sec"
            value={metrics.errorsPerSec}
            unit="/s"
            previousValue={previousMetrics?.errorsPerSec}
            icon="❌"
            status={getMetricStatus('errorsPerSec', metrics.errorsPerSec)}
          />
          <MetricCard
            title="Active Users"
            value={metrics.activeUsers}
            unit="users"
            icon="👥"
            status="neutral"
          />
          <MetricCard
            title="Latency (P95)"
            value={metrics.latencyP95}
            unit="ms"
            previousValue={previousMetrics?.latencyP95}
            icon="⏱️"
            status={getMetricStatus('latencyP95', metrics.latencyP95)}
          />
        </div>
      </div>

      {/* Time Series Chart */}
      <div className="dashboard__chart">
        <TimeSeriesChart
          requestsPerSec={metrics.requestsPerSec}
          errorsPerSec={metrics.errorsPerSec}
          height={300}
        />
      </div>

      {/* Logs */}
      <div className="dashboard__logs">
        <LogViewer
          logs={logs}
          onFilterChange={filterLogs}
          maxHeight={400}
        />
      </div>

      {/* Footer */}
      <div className="dashboard__footer">
        <p className="dashboard__footer-text">
          Last updated: {new Date().toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </p>
        <p className="dashboard__footer-info">
          Total Requests: {metrics.totalRequests} | Total Errors: {metrics.totalErrors}
        </p>
      </div>
    </div>
  );
}

export default Dashboard;
