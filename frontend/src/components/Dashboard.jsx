import React, { useCallback, useEffect, useState } from 'react'
import { apiFetchJson } from '../services/apiClient'
import '../styles/Dashboard.css'
import '../styles/MetricCard.css'

const PAGE_SIZE = 20

function MetricCard({ title, value, unit = '', tone = 'neutral' }) {
  return (
    <div className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__title">{title}</span>
      <div className="metric-card__value">
        <span className="metric-card__number">{value ?? '—'}</span>
        {unit && <span className="metric-card__unit">{unit}</span>}
      </div>
    </div>
  )
}

function formatTimestamp(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' })
}

export function Dashboard({ userRole = null }) {
  const isAdmin = userRole === 'admin' || userRole === 'superadmin'
  const [summary, setSummary] = useState(null)
  const [logs, setLogs] = useState([])
  const [alerts, setAlerts] = useState([])
  const [integrity, setIntegrity] = useState(null)
  const [pagination, setPagination] = useState({ page: 1, hasNext: false, total: 0 })
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ level: '', module: '', eventType: '', requestId: '', ticketId: '', search: '', from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const buildLogQuery = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, key === 'from' || key === 'to' ? new Date(value).toISOString() : value)
    })
    return params.toString()
  }, [filters, page])

  const load = useCallback(async () => {
    if (!isAdmin) return
    setError('')
    try {
      const requests = [
        apiFetchJson('/admin/monitoring/summary'),
        apiFetchJson(`/admin/monitoring/logs?${buildLogQuery()}`),
        apiFetchJson('/admin/monitoring/alerts?pageSize=10'),
      ]
      const [summaryData, logData, alertData] = await Promise.all(requests)
      setSummary(summaryData)
      setLogs(logData.logs || [])
      setPagination(logData.pagination || { page, hasNext: false, total: 0 })
      setAlerts(alertData.alerts || [])
      setLastUpdated(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [buildLogQuery, isAdmin, page])

  const loadIntegrity = useCallback(async () => {
    if (!isAdmin) return
    try {
      setIntegrity(await apiFetchJson('/admin/monitoring/integrity?limit=200'))
    } catch (err) {
      setError(err.message)
    }
  }, [isAdmin])

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => load(), 250)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => { loadIntegrity() }, [loadIntegrity])

  useEffect(() => {
    if (!isAdmin) return undefined
    const timer = setInterval(() => load(), 15000)
    return () => clearInterval(timer)
  }, [isAdmin, load])

  const updateFilter = (key, value) => {
    setPage(1)
    setFilters((current) => ({ ...current, [key]: value }))
  }

  if (!isAdmin) {
    return <div className="dashboard__error-banner">Se requiere rol de administrador para consultar el monitoreo.</div>
  }

  const metrics = summary?.metrics || {}
  const status = summary?.status || 'UNKNOWN'
  const statusTone = status === 'HEALTHY' ? 'good' : status === 'DEGRADED' ? 'warning' : 'critical'

  return (
    <div className="dashboard">
      <div className="dashboard__header">
        <div>
          <h1 className="dashboard__title">Monitoreo del sistema</h1>
          <p className="dashboard__subtitle">Estado, errores, latencia, alertas e integridad de tickets.</p>
        </div>
        <div className={`dashboard__status dashboard__status--${statusTone}`}>
          {status === 'HEALTHY' ? 'Saludable' : status === 'DEGRADED' ? 'Degradado' : status === 'INCIDENT' ? 'Incidente' : 'Sin datos'}
        </div>
      </div>

      {error && <div className="dashboard__error-banner">{error}</div>}

      <div className="dashboard__metrics-grid">
        <MetricCard title="Solicitudes / segundo" value={metrics.requestsPerSec} tone="good" />
        <MetricCard title="Tasa de error reciente" value={((metrics.recentErrorRate || 0) * 100).toFixed(1)} unit="%" tone={(metrics.recentErrorRate || 0) >= 0.05 ? 'warning' : 'good'} />
        <MetricCard title="Latencia P95" value={metrics.latencyP95} unit="ms" tone={(metrics.latencyP95 || 0) >= 1000 ? 'warning' : 'good'} />
        <MetricCard title="Usuarios activos" value={metrics.activeUsers} />
        <MetricCard title="Errores acumulados" value={metrics.totalErrors} tone={(metrics.totalErrors || 0) > 0 ? 'warning' : 'good'} />
        <MetricCard title="Base de datos" value={summary?.dependencies?.database?.status || '—'} tone={summary?.dependencies?.database?.status === 'UP' ? 'good' : 'critical'} />
      </div>

      <section className="dashboard__panel">
        <div className="dashboard__section-heading">
          <h2>Alertas recientes</h2>
          <button className="dashboard__button" onClick={() => { load(); loadIntegrity() }} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</button>
        </div>
        {alerts.length === 0 ? <p className="dashboard__empty">Sin alertas activadas en este proceso.</p> : (
          <div className="dashboard__alert-list">
            {alerts.map((alert) => (
              <div className={`dashboard__alert dashboard__alert--${alert.severity.toLowerCase()}`} key={alert.id}>
                <strong>{alert.type}</strong>
                <span>{alert.summary}</span>
                <small>{formatTimestamp(alert.timestamp)} · correlación: {alert.correlationId || '—'}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="dashboard__panel">
        <div className="dashboard__section-heading">
          <h2>Integridad de tickets</h2>
          <span>{integrity ? `${integrity.incompleteCount} inconsistencias de ${integrity.scanned} revisados` : 'Pendiente'}</span>
        </div>
        {integrity?.incomplete?.length > 0 ? (
          <div className="dashboard__table-wrap">
            <table className="dashboard__table"><thead><tr><th>Ticket</th><th>Nivel</th><th>Problemas</th></tr></thead>
              <tbody>{integrity.incomplete.slice(0, 20).map((item) => <tr key={item.ticketId}><td>{item.ticketId}</td><td>{item.severity}</td><td>{item.issues.join(' ')}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="dashboard__empty">No se detectaron tickets incompletos en la muestra reciente.</p>}
      </section>

      <section className="dashboard__panel">
        <h2>Endpoints con mayor tasa de fallos</h2>
        <div className="dashboard__table-wrap">
          <table className="dashboard__table">
            <thead><tr><th>Endpoint</th><th>Solicitudes</th><th>Errores</th><th>Tasa</th><th>Latencia media</th></tr></thead>
            <tbody>{(metrics.endpoints || []).map((endpoint) => (
              <tr key={endpoint.route}><td>{endpoint.route}</td><td>{endpoint.requests}</td><td>{endpoint.errors}</td><td>{(endpoint.errorRate * 100).toFixed(1)}%</td><td>{endpoint.averageLatencyMs} ms</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="dashboard__panel">
        <div className="dashboard__section-heading"><h2>Logs estructurados</h2><span>{pagination.total || 0} resultados</span></div>
        <div className="dashboard__filters">
          <select value={filters.level} onChange={(event) => updateFilter('level', event.target.value)}><option value="">Todos los niveles</option><option>DEBUG</option><option>INFO</option><option>WARN</option><option>ERROR</option><option>FATAL</option></select>
          <input placeholder="Módulo" value={filters.module} onChange={(event) => updateFilter('module', event.target.value)} />
          <input placeholder="Tipo de evento" value={filters.eventType} onChange={(event) => updateFilter('eventType', event.target.value)} />
          <input placeholder="ID de solicitud o correlación" value={filters.requestId} onChange={(event) => updateFilter('requestId', event.target.value)} />
          <input placeholder="ID de ticket" value={filters.ticketId} onChange={(event) => updateFilter('ticketId', event.target.value)} />
          <input placeholder="Buscar mensaje" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} />
          <input type="datetime-local" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} aria-label="Desde" />
          <input type="datetime-local" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} aria-label="Hasta" />
        </div>
        <div className="dashboard__table-wrap">
          <table className="dashboard__table dashboard__logs-table">
            <thead><tr><th>Hora</th><th>Nivel</th><th>Módulo</th><th>Evento</th><th>Mensaje</th><th>Solicitud</th><th>Duración</th></tr></thead>
            <tbody>{logs.map((log, index) => (
              <tr key={`${log.timestamp}-${index}`} className={`dashboard__log--${log.level.toLowerCase()}`}>
                <td>{formatTimestamp(log.timestamp)}</td><td>{log.level}</td><td>{log.module}</td><td>{log.eventType}</td><td>{log.message}</td><td>{log.requestId || '—'}</td><td>{log.durationMs == null ? '—' : `${log.durationMs} ms`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="dashboard__pagination">
          <button onClick={() => setPage((value) => value - 1)} disabled={page === 1}>Anterior</button>
          <span>Página {page}</span>
          <button onClick={() => setPage((value) => value + 1)} disabled={!pagination.hasNext}>Siguiente</button>
        </div>
      </section>

      <p className="dashboard__footer-text">Última actualización: {lastUpdated ? lastUpdated.toLocaleTimeString('es-MX') : '—'} · actualización automática cada 15 segundos.</p>
    </div>
  )
}

export default Dashboard
