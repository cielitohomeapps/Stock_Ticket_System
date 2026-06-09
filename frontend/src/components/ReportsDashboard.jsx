import React, { useEffect, useState } from 'react'

export default function ReportsDashboard({ apiBase, firebaseToken, onBack }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [groupBy, setGroupBy] = useState('area')
  const [summary, setSummary] = useState({ totalItems: 0, totalTickets: 0, title: 'Área' })

  useEffect(() => {
    if (!firebaseToken) return
    setLoading(true)
    setError(null)
    const url = `${apiBase}/reports/locations?groupBy=${encodeURIComponent(groupBy)}`
    fetch(url, { headers: { Authorization: `Bearer ${firebaseToken}` } })
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data?.rows) ? data.rows : []
        setRows(list)
        setSummary({
          totalItems: Number(data?.totalItems || 0),
          totalTickets: Number(data?.totalTickets || 0),
          title: String(data?.title || (groupBy === 'destino' ? 'Destino' : 'Área')),
        })
      })
      .catch((err) => setError(err.message || 'Error'))
      .finally(() => setLoading(false))
  }, [apiBase, firebaseToken, groupBy])

  const maxCount = rows.reduce((m, r) => Math.max(m, r.ticketCount || 0), 0) || 1

  return (
    <div className="reports-page">
      <div className="page-header">
        <h1 className="page-title">Reportes por {summary.title}</h1>
        <p className="page-subtitle">Resumen de tickets y productos agrupados por {summary.title.toLowerCase()}.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button className="btn" onClick={onBack}>Volver</button>
        <button className={`btn${groupBy === 'area' ? ' active' : ''}`} onClick={() => setGroupBy('area')}>Por área</button>
        <button className={`btn${groupBy === 'destino' ? ' active' : ''}`} onClick={() => setGroupBy('destino')}>Por destino</button>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner"/> Cargando…</div>
      ) : error ? (
        <p style={{ color: 'var(--red)' }}>Error: {error}</p>
      ) : (
        <div>
          <div className="reports-summary" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="report-card">
              <strong>Total tickets</strong>
              <div style={{ fontSize: '24px', marginTop: 6 }}>{summary.totalTickets}</div>
            </div>
            <div className="report-card">
              <strong>Total productos</strong>
              <div style={{ fontSize: '24px', marginTop: 6 }}>{summary.totalItems}</div>
            </div>
            <div className="report-card">
              <strong>Resumen</strong>
              <div style={{ fontSize: '14px', marginTop: 6 }}>Agrupado por {summary.title.toLowerCase()}</div>
            </div>
          </div>

          <div className="reports-chart" style={{ marginBottom: 16 }}>
            {rows.slice(0, 8).map((r) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 200, fontSize: 13 }}>{r.label}</div>
                <div style={{ flex: 1, background: '#eee', height: 18, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(r.ticketCount / maxCount) * 100}%`, height: '100%', background: '#2b8cff' }} />
                </div>
                <div style={{ width: 80, textAlign: 'right', fontSize: 13 }}>{r.ticketCount}</div>
              </div>
            ))}
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>{summary.title}</th>
                <th>Tickets</th>
                <th>Total Items</th>
                <th>Último ticket</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td>{r.ticketCount}</td>
                  <td>{r.totalItems}</td>
                  <td>{r.lastTicketAt ? new Date(r.lastTicketAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
