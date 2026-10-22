import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

// ── Context ───────────────────────────────────────────────────────────────────
const ToastContext = createContext(null)

let _id = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const push = useCallback((message, type = 'info', duration = 4000, options = {}) => {
    const id = ++_id
    setToasts((prev) => [...prev, { id, message, type, ...options, exiting: false }])
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }, [])

  const dismiss = useCallback((id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    )
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 320)
  }, [])

  const toast = useMemo(() => ({
    success: (msg, d) => push(msg, 'success', d),
    error:   (msg, d) => push(msg, 'error',   d ?? 0),
    info:    (msg, d) => push(msg, 'info',     d),
    warning: (msg, d) => push(msg, 'warning',  d ?? 0),
    alert: ({ title, message, type = 'error', action, secondaryAction }) =>
      push(message, type, 0, { title, action, secondaryAction }),
    dismiss,
  }), [dismiss, push])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        toasts.length > 0 ? (
          <div
            className="toast-container"
            aria-live={toasts.some((item) => item.type === 'error' || item.type === 'warning') ? 'assertive' : 'polite'}
          >
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </div>
        ) : null,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICONS = {
  success: (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5"/>
    </svg>
  ),
  error: (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  warning: (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  info: (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
}

const TITLES = {
  success: '¡Listo!',
  error: '¡Error!',
  warning: '¡Atención!',
  info: 'Información',
}

function ToastItem({ toast, onDismiss }) {
  const dialogRef = useRef(null)
  const isAlert = toast.type === 'error' || toast.type === 'warning'

  useEffect(() => {
    if (!isAlert) return undefined
    const getButtons = () => dialogRef.current?.querySelectorAll('button') || []
    getButtons()[0]?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss(toast.id)
      if (event.key === 'Tab') {
        const buttons = getButtons()
        if (!buttons.length) return
        event.preventDefault()
        const index = Array.from(buttons).indexOf(document.activeElement)
        const nextIndex = event.shiftKey
          ? (index <= 0 ? buttons.length - 1 : index - 1)
          : (index < 0 || index === buttons.length - 1 ? 0 : index + 1)
        buttons[nextIndex].focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAlert, onDismiss, toast.id])

  const runAction = (action) => {
    action.onClick()
    onDismiss(toast.id)
  }

  return (
    <div ref={dialogRef} className={`toast toast-${toast.type} ${toast.exiting ? 'toast-exit' : 'toast-enter'}`} role={isAlert ? 'alertdialog' : 'status'} aria-modal={isAlert || undefined} aria-labelledby={`toast-title-${toast.id}`} aria-describedby={`toast-message-${toast.id}`}>
      <div className="toast-header">
        <span className="toast-icon" aria-hidden="true">{ICONS[toast.type]}</span>
      </div>
      <div className="toast-content">
        <strong className="toast-title" id={`toast-title-${toast.id}`}>{toast.title || TITLES[toast.type]}</strong>
        <p className="toast-msg" id={`toast-message-${toast.id}`}>{toast.message}</p>
        <div className="toast-actions">
          {toast.action && (
            <button className="toast-action" onClick={() => runAction(toast.action)}>
              {toast.action.label}
            </button>
          )}
          {toast.secondaryAction && (
            <button className="toast-action toast-action-secondary" onClick={() => runAction(toast.secondaryAction)}>
              {toast.secondaryAction.label}
            </button>
          )}
          <button className="toast-close" onClick={() => onDismiss(toast.id)}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
