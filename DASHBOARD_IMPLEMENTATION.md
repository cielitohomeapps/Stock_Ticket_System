# 📊 Real-Time Monitoring Dashboard Implementation Guide

## Overview

This implementation adds a professional real-time monitoring dashboard to your SaaS ticket automation application. The dashboard displays live system metrics, event logs, and performance analytics with WebSocket-based updates and graceful HTTP polling fallback.

## Architecture

### Backend Components

#### 1. **Metrics Service** (`backend/src/services/metrics.service.js`)
Core in-memory metrics collection and aggregation.

**Key Classes:**
- `CircularBuffer` - Fixed-size FIFO buffer for logs (auto-overwrites oldest entries)
- `LatencyHistogram` - Maintains rolling window of latency samples for percentile calculation
- `MetricsStore` - Singleton store managing all metrics with session cleanup

**API:**
```javascript
metricsStore.recordRequest(statusCode, durationMs, userId)
metricsStore.recordEvent(eventType, severity, message, metadata)
metricsStore.getSnapshot() // Returns current aggregated metrics
metricsStore.getRecentEvents(count, severity) // Get filtered logs
```

#### 2. **WebSocket Service** (`backend/src/services/websocket.service.js`)
Manages real-time connections and metric broadcasts.

**Functions:**
- `initMetricsWebSocket(server, WebSocket)` - Initialize WS server
- `startMetricsBroadcast(intervalMs)` - Start periodic metric broadcasting (default 5s)
- `broadcastEvent(eventType, data)` - Send real-time notifications to all clients

**Message Types:**
```
{type: "init", metrics, logs} - Initial connection
{type: "metrics_update", metrics, recentEvents} - Periodic updates
{type: "logs", logs, severity} - Filtered log response
{type: "event", eventType, data} - Real-time event notification
```

#### 3. **Middleware** (`backend/src/app.js`)
Request-level instrumentation:
```javascript
app.use((req, res, next) => {
  const startTime = Date.now()
  res.on("finish", () => {
    metricsStore.recordRequest(res.statusCode, Date.now() - startTime, req.user?.id)
  })
  next()
})
```

#### 4. **Polling Endpoint** (`backend/src/app.js`)
Fallback HTTP endpoint for metrics:
```javascript
GET /api/metrics/snapshot
Response: { metrics: {...}, logs: [...] }
```

### Frontend Components

#### 1. **useRealtimeMetrics Hook** (`frontend/src/hooks/useRealtimeMetrics.js`)
Custom React hook managing WebSocket lifecycle and fallback logic.

**Features:**
- Automatic reconnection with exponential backoff (configurable)
- Fallback to HTTP polling (30s interval by default)
- Token-based authentication
- Message queuing for pending requests

**Usage:**
```javascript
const {metrics, logs, isConnected, error, filterLogs, reconnect} = useRealtimeMetrics({
  token: firebaseToken,
  enablePolling: true,
  reconnectConfig: {
    initialDelay: 1000,
    maxDelay: 30000,
    multiplier: 1.5,
    maxAttempts: 10,
  }
})
```

**State Structure:**
```javascript
metrics: {
  requestsPerSec: number,
  errorsPerSec: number,
  activeUsers: number,
  latencyP95: number,
  latencyAvg: number,
  totalRequests: number,
  totalErrors: number,
  requestsByStatus: object,
}
logs: [
  {
    timestamp: ISO8601,
    eventType: string,
    severity: "info"|"warn"|"error",
    message: string,
    metadata: object,
  },
  ...
]
```

#### 2. **MetricCard Component** (`frontend/src/components/MetricCard.jsx`)
Individual metric display with trend indicator.

**Props:**
- `title` - Metric name
- `value` - Current value
- `unit` - Unit suffix (e.g., "ms", "/s")
- `previousValue` - For trend calculation (optional)
- `icon` - Emoji or icon
- `status` - "good" | "warning" | "critical" | "neutral"

#### 3. **LogViewer Component** (`frontend/src/components/LogViewer.jsx`)
Virtualized log list with react-window for performance.

**Features:**
- 1000+ logs rendered efficiently
- Real-time filtering by severity
- Reverse chronological order (newest first)
- Severity-based color coding

**Props:**
- `logs` - Array of log entries
- `onFilterChange` - Callback for filter changes
- `maxHeight` - Container height in pixels

#### 4. **TimeSeriesChart Component** (`frontend/src/components/TimeSeriesChart.jsx`)
60-minute time-series using Recharts.

**Props:**
- `requestsPerSec` - Request rate metric
- `errorsPerSec` - Error rate metric
- `height` - Chart height (default 300px)

**Note:** Current implementation uses synthetic data. For production, implement backend time-series DB storage.

#### 5. **Dashboard Component** (`frontend/src/components/Dashboard.jsx`)
Main dashboard page orchestrating all components.

**Features:**
- Status banner showing connection state
- 4 key metric cards
- Time-series chart
- Live log stream
- Error handling and reconnection UI

**Props:**
- `firebaseToken` - Firebase auth token
- `userRole` - User role for permission checks

## Deployment & Usage

### 1. Installation

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd frontend
npm install
```

### 2. Start Services

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

### 3. Access Dashboard

1. Open http://localhost:5173
2. Login with your Firebase credentials
3. Admin users see a "Monitor" button in navbar
4. Click "Monitor" → navigate to dashboard

### 4. Production Deployment

**Backend:**
- Ensure `ws` library is in dependencies
- WebSocket endpoint: `wss://your-domain/api/metrics` (use `wss://` for HTTPS)
- Metrics are stored in-memory; consider adding persistence:
  ```javascript
  // Example: Persist metrics to Redis
  import redis from 'redis'
  const client = redis.createClient()
  setInterval(() => {
    client.setex('metrics:current', 300, JSON.stringify(metricsStore.getSnapshot()))
  }, 5000)
  ```

**Frontend:**
- Build: `npm run build`
- Deploy `dist/` folder to CDN
- WebSocket URL auto-derives from `window.location`

## Metrics Definitions

| Metric | Source | Meaning | Good Threshold |
|--------|--------|---------|-----------------|
| **Request Rate** | Express middleware | Requests per second | Based on capacity |
| **Error Rate** | Error responses (4xx, 5xx) | Errors per second | < 0.5 /s |
| **Active Users** | WebSocket sessions | Concurrent users online | Real-time count |
| **Latency P95** | Response timing histogram | 95th percentile response time | < 200ms |
| **Avg Latency** | Response timing histogram | Average response time | < 100ms |

## Event Types

Events recorded in logs:
```
TICKET_CREATED - New ticket created
TICKET_SENT_TO_REVIEW - Ticket submitted for approval
TICKET_APPROVED - Admin approved ticket
TICKET_REJECTED - Admin rejected ticket
STOCK_MOVEMENT_APPLIED - Inventory updated
USER_LOGIN - User authenticated
ERROR_* - Various error events
```

## WebSocket Message Flow

```
Client                          Server
   |                              |
   |-----(1) Connection upgrade---|
   |                              |
   |<----- (2) init message ------|  (metrics + logs snapshot)
   |                              |
   |<----- (3) metrics_update -----|  (every 5s)
   |                              |
   |----(4) filter_logs msg ------>|  (client requests filtered logs)
   |                              |
   |<----- (5) logs response -------|
   |                              |
   |  [connection maintained]     |
   |                              |
   |<----- (6) event notify -------|  (real-time alerts)
   |                              |
   |-----(7) Close connection -----|
   |                              |
```

## HTTP Polling Fallback

When WebSocket is unavailable (browser doesn't support, firewall blocks, etc):

1. Client detects connection failure after 10 retry attempts
2. Switches to polling mode (GET /api/metrics/snapshot)
3. Polls every 30 seconds for metric snapshots
4. UI displays "🟡 Polling (30s interval)" status
5. User can manually reconnect to attempt WebSocket again

## Performance Considerations

### Memory Usage
- Circular buffer: ~1KB per log entry × 1000 = ~1MB
- Latency histogram: ~300 samples × 8 bytes = ~2.4KB
- Active sessions: ~1KB per concurrent user
- Request window: ~30 samples × 8 bytes = ~240B

**Total per 1000 concurrent users:** ~1-5 MB

### CPU Usage
- Request middleware: ~0.1ms per request
- Metric broadcast: ~10ms per 1000 connected clients (every 5s)
- Exponential backoff prevents thundering herd on reconnection

### Network Usage
- Per broadcast: ~500B per client every 5s = 100B/s per client
- Per polling: ~500B every 30s = 17B/s per client

## Customization Examples

### Add Custom Metric

```javascript
// In metric collection
metricsStore.recordMetric('custom_payment_time', 1250) // ms

// In dashboard
<MetricCard
  title="Payment Processing"
  value={metrics.paymentTime}
  unit="ms"
  icon="💳"
/>
```

### Change Broadcast Interval

```javascript
// In server.js
const broadcastInterval = startMetricsBroadcast(10000) // 10 seconds instead of 5
```

### Add Status-Based Alert

```javascript
// In dashboard.jsx
const hasHighErrorRate = metrics.errorsPerSec > 1

return (
  <>
    {hasHighErrorRate && (
      <AlertBanner severity="critical" message="High error rate detected!" />
    )}
    ...
  </>
)
```

### Persist Metrics to Database

```javascript
// In a new service/persistence.service.js
async function persistMetrics(metrics) {
  await db.collection('metricsHistory').add({
    snapshot: metrics,
    timestamp: FieldValue.serverTimestamp(),
  })
}

// Schedule in server.js
setInterval(() => {
  persistMetrics(metricsStore.getSnapshot())
}, 60000) // Every minute
```

## Troubleshooting

### Dashboard Shows "Disconnected"

1. Check backend is running: `curl http://localhost:3001/api/health`
2. Check WebSocket is accessible: browser DevTools → Network → WS
3. Check logs for connection errors
4. Verify polling fallback working: GET /api/metrics/snapshot returns data

### Metrics Not Updating

1. Check middleware is installed in app.js
2. Verify metricsStore is imported
3. Check browser console for WebSocket errors
4. Monitor backend logs for broadcast errors

### High Memory Usage

1. Reduce circular buffer size (default 1000):
   ```javascript
   const eventLog = new CircularBuffer(500)
   ```

2. Reduce polling interval if using HTTP fallback
3. Implement metrics persistence/archival

### WebSocket Reconnection Stuck

1. Check max reconnection attempts (default 10)
2. Verify server is responding to upgrade requests
3. Check firewall allows WebSocket protocol (ws/wss)

## Browser Compatibility

- **Chrome 16+** - Full WebSocket support
- **Firefox 11+** - Full WebSocket support
- **Safari 5.1+** - Full WebSocket support
- **IE 10+** - WebSocket supported (IE 9 and below need polling)
- **Mobile Safari** - Full support (iOS 5+)
- **Android Browser** - Full support (4.4+)

Polling fallback ensures compatibility with older browsers automatically.

## Security Considerations

1. **Authentication**: WebSocket uses Bearer token from Headers/Query
   - In production, use dedicated auth endpoint for token exchange

2. **Rate Limiting**: Implement rate limits on /api/metrics/snapshot
   ```javascript
   const rateLimit = require('express-rate-limit')
   const metricsLimiter = rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 100
   })
   app.get('/api/metrics/snapshot', metricsLimiter, ...)
   ```

3. **Data Sanitization**: Validate event metadata before storage
   ```javascript
   const sanitized = {
     eventType: eventType.slice(0, 50),
     severity: severity in ['info', 'warn', 'error'] ? severity : 'info',
     ...
   }
   ```

4. **Access Control**: Only admins should access dashboard
   - Already implemented: `{isAdmin && <button>Monitor</button>}`

## Future Enhancements

1. **Historical Data**: Persist metrics to time-series DB (InfluxDB, TimescaleDB)
2. **Alerting**: Set thresholds and send notifications (email, Slack, PagerDuty)
3. **Custom Dashboards**: Let users create custom metric layouts
4. **Comparison**: Compare metrics across time periods
5. **Distributed Tracing**: Integrate with OpenTelemetry
6. **Advanced Filtering**: SQL-like query interface for logs
7. **Export**: Download metrics as CSV/JSON

## Files Reference

```
backend/
├── src/
│   ├── app.js (updated - added metrics middleware & endpoint)
│   ├── server.js (updated - added WebSocket init)
│   ├── services/
│   │   ├── metrics.service.js (NEW)
│   │   ├── websocket.service.js (NEW)
│   │   └── audit.service.js (updated - event recording)
│   └── package.json (updated - added ws)
│
frontend/
├── src/
│   ├── App.jsx (updated - added dashboard route)
│   ├── hooks/
│   │   └── useRealtimeMetrics.js (NEW)
│   ├── components/
│   │   ├── Dashboard.jsx (NEW)
│   │   ├── MetricCard.jsx (NEW)
│   │   ├── LogViewer.jsx (NEW)
│   │   └── TimeSeriesChart.jsx (NEW)
│   ├── styles/
│   │   ├── Dashboard.css (NEW)
│   │   ├── MetricCard.css (NEW)
│   │   ├── LogViewer.css (NEW)
│   │   └── TimeSeriesChart.css (NEW)
│   └── package.json (updated - added recharts, react-window)
│
└── install-dashboard.sh (setup script)
```

## Support & Questions

For issues or questions about the dashboard:

1. Check browser DevTools → Console for JavaScript errors
2. Check backend logs: `npm run dev` output
3. Test WebSocket: `websocat ws://localhost:3001/api/metrics`
4. Verify configuration in `.env` files

---

**Happy monitoring! 📊🚀**
