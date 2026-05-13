import React, { useState } from 'react'
import logoCH from '../assets/logoch.jpeg'

const TYPE_LABEL = { EXIT: 'Salida', ENTRY: 'Entrada' }

function CielitoHomeLogo() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <img src={logoCH} alt="Cielito Home" style={{ height: '58px', objectFit: 'contain' }} />
    </div>
  )
}

const PdfIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    <line x1="12" y1="12" x2="12" y2="18"/><polyline points="9 15 12 18 15 15"/>
  </svg>
)
const WordIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>
  </svg>
)

export default function StepResult({ ticketId, area, ticketType, selectedItems, reason, firma, destino, apiBase, firebaseToken, onReset }) {
  const [downloading, setDownloading] = useState(null) // 'pdf' | 'word' | null

  const download = async (format) => {
    setDownloading(format)
    try {
      const url = `${apiBase}/tickets/${ticketId}/download?format=${format}`
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${firebaseToken}` },
      })
      if (!res.ok) { alert('Error al generar el documento. Inténtalo de nuevo.'); return }
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

  return (
    <div className="ticket-card">

      {/* Header */}
      <div className="ticket-header">
        <div className="ticket-header-badge">
          <span>Ticket de {TYPE_LABEL[ticketType]?.toUpperCase() || ticketType}</span>
        </div>
      </div>

      <div className="ticket-body">

        {/* Área */}
        <p className="ticket-area-title">Área: {area}</p>

        {/* Pending badge */}
        <div className="pending-badge">
          <span style={{ fontSize: '18px' }}>⏳</span>
          <span className="pending-badge-text">Pendiente de aprobación del administrador</span>
        </div>

        {/* Ticket ID */}
        <div className="ticket-id-box">
          <span className="ticket-id-label-sm">Ticket ID</span>
          <span className="ticket-id-value">{ticketId}</span>
        </div>

        {/* Summary */}
        <div className="ticket-main-grid">

          <div>
            {selectedItems.length > 0 && (
              <>
                <p className="ticket-section-label">Productos</p>
                <div className="products-list" style={{ maxHeight: '180px' }}>
                  {selectedItems.map((item) => (
                    <div key={item.productId} className="product-row selected" style={{ cursor: 'default' }}>
                      <div className="product-bullet" />
                      <div className="product-chip">
                        <span>{item.name}</span>
                        <span className="product-stock">×{item.qty}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="field-inline" style={{ marginTop: '16px', marginBottom: 0 }}>
              <span className="field-inline-label">Razón:</span>
              <span style={{
                borderBottom: '2px solid var(--border)',
                flex: 1, padding: '4px 6px',
                fontSize: '13px', color: 'var(--text)',
              }}>
                {reason}
              </span>
            </div>
            {destino && (
              <div className="field-inline" style={{ marginTop: '8px', marginBottom: 0 }}>
                <span className="field-inline-label">Destino:</span>
                <span style={{
                  borderBottom: '2px solid var(--border)',
                  flex: 1, padding: '4px 6px',
                  fontSize: '13px', color: 'var(--text)',
                }}>
                  {destino}
                </span>
              </div>
            )}
          </div>

          {/* Logo + firma */}
          <div className="ticket-side">
            <CielitoHomeLogo />
            <div className="firma-field">
              <span className="firma-label">Firma</span>
              <span className="firma-value">{firma}</span>
            </div>
          </div>
        </div>

        {/* Download */}
        <div className="download-section">
          <p className="download-label">Descargar copia del ticket</p>
          <div className="download-btns">
            <button
              className="btn-download pdf"
              onClick={() => download('pdf')}
              disabled={downloading !== null}
            >
              {downloading === 'pdf' ? <span className="spinner spinner-sm" style={{ borderTopColor: 'rgba(255,255,255,0.9)' }} /> : <PdfIcon />}
              PDF
            </button>
            <button
              className="btn-download word"
              onClick={() => download('word')}
              disabled={downloading !== null}
            >
              {downloading === 'word' ? <span className="spinner spinner-sm" style={{ borderTopColor: 'rgba(255,255,255,0.9)' }} /> : <WordIcon />}
              Word
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button className="btn-secondary" onClick={onReset}>
              + Crear nuevo ticket
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
