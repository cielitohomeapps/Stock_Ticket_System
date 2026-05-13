import React, { useState, useEffect, useCallback } from 'react'

const TYPE_LABEL = { EXIT: 'Salida', ENTRY: 'Entrada' }
const STATUS_LABEL = {
  CREADO: 'Creado',
  EN_REVISION: 'En revisión',
  RECHAZADO: 'Rechazado',
  STOCK_ACTUALIZADO: 'Stock actualizado',
  NOTIFICADO: 'Notificado',
}
const STATUS_COLOR = {
  CREADO: 'var(--text-muted)',
  EN_REVISION: '#b07d00',
  RECHAZADO: 'var(--red)',
  STOCK_ACTUALIZADO: 'var(--green)',
  NOTIFICADO: 'var(--green)',
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
}

const PdfIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    <line x1="12" y1="12" x2="12" y2="18"/><polyline points="9 15 12 18 15 15"/>
  </svg>
)
const WordIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>
  </svg>
)

const PAGE_SIZE = 10

export default function HistoryPanel({ apiBase, firebaseToken, onBack }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [downloading, setDownloading] = useState(null) // `${ticketId}-pdf` | `${ticketId}-word`
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/my-tickets`, {
        headers: { Authorization: `Bearer ${firebaseToken}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setTickets(data.tickets || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiBase, firebaseToken])

  useEffect(() => { load() }, [load])

  const download = async (ticketId, format) => {
    const key = `${ticketId}-${format}`
    setDownloading(key)
    try {
      const res = await fetch(`${apiBase}/tickets/${ticketId}/download?format=${format}`, {
        headers: { Authorization: `Bearer ${firebaseToken}` },
      })
      if (!res.ok) { alert('Error al generar el documento.'); return }
      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = format === 'word' ? `ticket-${ticketId}.docx` : `ticket-${ticketId}.pdf`
      link.click()
      URL.revokeObjectURL(link.href)
    } finally {
      setDownloading(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE))
  const paginated = tickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="history-panel">
      <div className="history-header">
        <div className="history-header-left">
          <button className="btn-back" onClick={onBack}>← Volver</button>
          <h2 className="history-title">Mi Historial de Tickets</h2>
        </div>
        <button className="btn-admin-secondary" onClick={load} disabled={loading} style={{ fontSize: '13px' }}>
          {loading ? '…' : '↺ Actualizar'}
        </button>
      </div>

      {error && (
        <div className="admin-error" style={{ margin: '0 0 16px' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {error}
        </div>
      )}

      {loading ? (
        <div className="history-skeleton">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="history-skeleton-row">
              <div className="skeleton skeleton-text" style={{ width: '80px' }} />
              <div className="skeleton skeleton-text" style={{ flex: 1 }} />
              <div className="skeleton skeleton-text" style={{ width: '60px' }} />
              <div className="skeleton skeleton-text" style={{ width: '80px' }} />
              <div className="skeleton skeleton-text" style={{ width: '100px' }} />
            </div>
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div className="admin-empty">
          <div className="empty-state-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <strong>Sin tickets enviados</strong>
          <p>Aquí aparecerán los tickets que hayas creado.</p>
        </div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Área</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th>Descargar</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((t) => (
                  <React.Fragment key={t.id}>
                    <tr
                      className={`admin-row ${expandedId === t.id ? 'expanded' : ''}`}
                      onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    >
                      <td className="ticket-id">{t.id.slice(0, 8)}…</td>
                      <td>{t.metadata?.area || '—'}</td>
                      <td>
                        <span className={`badge badge-${t.type?.toLowerCase()}`}>
                          {TYPE_LABEL[t.type] || t.type}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-pill status-${t.status}`}
                          style={{ color: STATUS_COLOR[t.status] }}
                        >
                          {STATUS_LABEL[t.status] || t.status}
                        </span>
                      </td>
                      <td>{formatDate(t.createdAt)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="action-btns">
                          <button
                            className="btn-download-sm pdf"
                            disabled={downloading === `${t.id}-pdf`}
                            onClick={() => download(t.id, 'pdf')}
                            title="Descargar PDF"
                          >
                            {downloading === `${t.id}-pdf`
                              ? <span className="spinner spinner-sm" style={{ borderTopColor: 'rgba(255,255,255,0.9)', width: 12, height: 12 }} />
                              : <PdfIcon />}
                            PDF
                          </button>
                          <button
                            className="btn-download-sm word"
                            disabled={downloading === `${t.id}-word`}
                            onClick={() => download(t.id, 'word')}
                            title="Descargar Word"
                          >
                            {downloading === `${t.id}-word`
                              ? <span className="spinner spinner-sm" style={{ borderTopColor: 'rgba(255,255,255,0.9)', width: 12, height: 12 }} />
                              : <WordIcon />}
                            Word
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === t.id && (
                      <tr className="admin-detail-row">
                        <td colSpan={6}>
                          <div className="admin-detail">
                            <div className="admin-detail-section">
                              <strong>ID completo</strong>
                              <span style={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>{t.id}</span>
                            </div>
                            <div className="admin-detail-section">
                              <strong>Motivo</strong>
                              <span>{t.metadata?.motivo || '—'}</span>
                            </div>
                            {t.metadata?.destino && (
                              <div className="admin-detail-section">
                                <strong>Destino</strong>
                                <span>{t.metadata.destino}</span>
                              </div>
                            )}
                            <div className="admin-detail-section">
                              <strong>Firma</strong>
                              <span>{t.metadata?.firma || '—'}</span>
                            </div>
                            {t.reviewComment && (
                              <div className="admin-detail-section">
                                <strong>Comentario admin</strong>
                                <span style={{ color: 'var(--red)' }}>{t.reviewComment}</span>
                              </div>
                            )}
                            <div className="admin-detail-section admin-detail-full">
                              <strong>Productos ({t.items?.length || 0})</strong>
                              <ul className="admin-items-list">
                                {(t.items || []).map((item, i) => (
                                  <li key={i}>
                                    {item.nombre || item.name || item.productId || item.id}
                                    {item.qty ? ` ×${item.qty}` : ''}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn-admin-secondary btn-sm" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>← Anterior</button>
              <span className="pagination-info">Página {page} de {totalPages} · {tickets.length} tickets</span>
              <button className="btn-admin-secondary btn-sm" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>Siguiente →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
