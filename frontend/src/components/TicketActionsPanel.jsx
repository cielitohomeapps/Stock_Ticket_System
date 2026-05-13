import React, { useState } from 'react'

export default function TicketActionsPanel({ ticketId, setTicketId, callApi }) {
  const [rejectComment, setRejectComment] = useState('Falta informacion')

  const requireTicketId = () => {
    if (!ticketId.trim()) {
      alert('Por favor ingresa un Ticket ID')
      return false
    }
    return true
  }

  return (
    <section className="panel">
      <h2>Acciones ticket</h2>
      <div className="grid two">
        <label>
          Ticket ID
          <input
            type="text"
            placeholder="Pega el ticketId"
            value={ticketId}
            onChange={(e) => setTicketId(e.target.value)}
          />
        </label>
        <label>
          Comentario rechazo
          <input
            type="text"
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
          />
        </label>
      </div>
      <div className="actions">
        <button
          onClick={() => {
            if (requireTicketId()) {
              callApi(
                'Enviar a revision',
                `/tickets/${encodeURIComponent(ticketId)}/send-review`,
                'POST'
              )
            }
          }}
        >
          Enviar a revision
        </button>
        <button
          className="accent"
          onClick={() => {
            if (requireTicketId()) {
              callApi(
                'Aprobar ticket',
                `/tickets/${encodeURIComponent(ticketId)}/review`,
                'POST',
                { decision: 'APPROVE' }
              )
            }
          }}
        >
          Aprobar
        </button>
        <button
          className="warn"
          onClick={() => {
            if (requireTicketId()) {
              callApi(
                'Rechazar ticket',
                `/tickets/${encodeURIComponent(ticketId)}/review`,
                'POST',
                {
                  decision: 'REJECT',
                  comment: rejectComment,
                }
              )
            }
          }}
        >
          Rechazar
        </button>
        <button
          onClick={() => {
            if (requireTicketId()) {
              callApi(
                'Consultar ticket',
                `/tickets/${encodeURIComponent(ticketId)}`,
                'GET'
              )
            }
          }}
        >
          Consultar ticket
        </button>
        <button onClick={() => callApi('Health', '/health', 'GET')}>
          Health
        </button>
      </div>
    </section>
  )
}
