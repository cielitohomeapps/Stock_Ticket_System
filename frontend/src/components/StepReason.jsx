import React from 'react'

export default function StepReason({ reason, setReason, firma, setFirma, assignedEmail, setAssignedEmail, onNext, onBack }) {
  const valid = reason.trim() && firma.trim()

  return (
    <div className="wizard-step">
      <h2 className="step-title"><span className="step-num">3</span> Razón y firma</h2>

      <div className="field-group">
        <label>
          Razón del movimiento <span className="required">*</span>
          <textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe el motivo del movimiento de inventario..."
          />
        </label>
      </div>

      <div className="field-group">
        <label>
          Firma (nombre completo) <span className="required">*</span>
          <input
            type="text"
            value={firma}
            onChange={(e) => setFirma(e.target.value)}
            placeholder="ej. Juan Pérez García"
          />
        </label>
      </div>

      <div className="field-group">
        <label>
          Correo de notificación (opcional)
          <input
            type="email"
            value={assignedEmail}
            onChange={(e) => setAssignedEmail(e.target.value)}
            placeholder="ej. almacen@empresa.com"
          />
        </label>
      </div>

      <div className="step-footer">
        <button className="btn-secondary" onClick={onBack}>← Volver</button>
        <button className="btn-primary" disabled={!valid} onClick={onNext}>
          Enviar ticket →
        </button>
      </div>
    </div>
  )
}
