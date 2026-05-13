import React, { useState, useEffect } from 'react'
import { onIdTokenChanged, signOut } from 'firebase/auth'
import { auth } from './config/firebase'
import './App.css'
import FirebaseAuthPanel from './components/GoogleAuthPanel'
import TicketForm from './components/TicketForm'
import StepResult from './components/StepResult'
import AdminPanel from './components/AdminPanel'
import HistoryPanel from './components/HistoryPanel'
import { ToastProvider } from './components/Toast'
import logoCH from './assets/logoch.jpeg'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const STEPS = ['Autenticación', 'Ticket', 'Resultado']

// ── Hash-based navigation ────────────────────────────────────────────────────
function getHashView() {
  const hash = window.location.hash.slice(1)
  if (hash.startsWith('admin')) return 'admin'
  if (hash === 'history') return 'history'
  return 'ticket'
}

function App() {
  const [firebaseToken, setFirebaseToken] = useState(null)
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [authError, setAuthError] = useState(null)
  const [step, setStep] = useState(0)
  const [userRole, setUserRole] = useState(null)
  const [view, setView] = useState('ticket') // 'ticket' | 'admin'
  const [initializing, setInitializing] = useState(true) // true while Firebase checks stored session

  // onIdTokenChanged fires on login AND every ~1h when Firebase auto-refreshes the token
  useEffect(() => {
    let roleAlreadyFetched = false
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (user) {
        try {
          const token = await user.getIdToken()
          setFirebaseToken(token)
          setFirebaseUser(user)
          setStep((s) => (s === 0 ? 1 : s))
          setView(getHashView())
          // Fetch role only once per session (not on every token refresh)
          if (!roleAlreadyFetched) {
            roleAlreadyFetched = true
            fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } })
              .then((r) => r.ok ? r.json() : null)
              .then((data) => { if (data?.role) setUserRole(data.role) })
              .catch(() => {})
          }
        } catch (err) {
          setAuthError('Error al obtener token: ' + err.message)
        }
      } else {
        setFirebaseToken(null)
        setFirebaseUser(null)
        setUserRole(null)
        roleAlreadyFetched = false
        setStep(0)
        setView('ticket')
        window.location.hash = ''
      }
      setInitializing(false) // Firebase has resolved — show UI
    })
    return () => unsubscribe()
  }, [])

  // Sync view with browser back/forward buttons
  useEffect(() => {
    const handleHashChange = () => {
      if (firebaseToken) setView(getHashView())
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [firebaseToken])

  const [area, setArea] = useState('')
  const [ticketType, setTicketType] = useState('EXIT')
  const [selectedItems, setSelectedItems] = useState([])
  const [reason, setReason] = useState('')
  const [firma, setFirma] = useState('')
  const [destino, setDestino] = useState('')

  const [ticketId, setTicketId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const handleSubmit = async ({ area: a, ticketType: type, fecha, selectedItems: items, reason: r, firma: f, destino: d }) => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body = {
        type,
        items,
        assignedUsers: [],
        metadata: { area: a, motivo: r, firma: f, destino: d, fecha },
      }

      const res = await fetch(`${API_BASE}/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${firebaseToken}`,
        },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `Error ${res.status}`)

      // Automatically send to review so it appears in the admin panel
      await fetch(`${API_BASE}/tickets/${data.ticketId}/send-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${firebaseToken}`,
        },
      })

      setArea(a)
      setTicketType(type)
      setSelectedItems(items)
      setReason(r)
      setFirma(f)
      setDestino(d)
      setTicketId(data.ticketId)
      setStep(2)
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setStep(1)
    setArea('')
    setTicketType('EXIT')
    setSelectedItems([])
    setReason('')
    setFirma('')
    setDestino('')
    setTicketId(null)
    setSubmitError(null)
  }

  const logout = async () => {
    try {
      await signOut(auth)
      setFirebaseToken(null)
      setFirebaseUser(null)
      setUserRole(null)
      setStep(0)
      setView('ticket')
      window.location.hash = ''
      reset()
    } catch (err) {
      console.error('Error al cerrar sesión:', err)
    }
  }

  const isAdmin = userRole === 'admin' || userRole === 'superadmin'

  return (
    <ToastProvider>
    <div className="app">

      {/* ── Navbar ── */}
      <nav className="navbar">
        <div className="navbar-brand">
          <img src={logoCH} alt="Cielito Home" className="navbar-logo" />
          <div className="navbar-brand-text">
            <span className="navbar-brand-name">Cielito Home</span>
            <span className="navbar-brand-sub">Gestión de Inventario</span>
          </div>
        </div>

        {firebaseUser ? (
          <div className="navbar-right">
            {isAdmin && (
              <button
                className={`navbar-nav-btn ${view === 'admin' ? 'active' : ''}`}
                onClick={() => {
                  if (view === 'admin') { window.location.hash = 'ticket'; setView('ticket') }
                  else { window.location.hash = 'admin/tickets'; setView('admin') }
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/><path d="M18 14l1.5 1.5L22 13"/></svg>
                {view === 'admin' ? 'Ir a Tickets' : 'Panel Admin'}
              </button>
            )}
            <button
              className={`navbar-nav-btn ${view === 'history' ? 'active' : ''}`}
              onClick={() => {
                if (view === 'history') { window.location.hash = 'ticket'; setView('ticket') }
                else { window.location.hash = 'history'; setView('history') }
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h6l3 9 4-6h5"/><path d="M21 21H3"/></svg>
              Mis Tickets
            </button>
            <div className="navbar-user">
              <div className="navbar-avatar">{(firebaseUser.email || '?')[0].toUpperCase()}</div>
              <span className="navbar-email">{firebaseUser.email}</span>
            </div>
            <button className="navbar-logout" onClick={logout} title="Cerrar sesión">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Salir
            </button>
          </div>
        ) : (
          <div className="navbar-right">
            <span className="navbar-tagline">Sistema de Inventario</span>
          </div>
        )}
      </nav>

      {/* ── Content ── */}
      <main className="main-content">
        {authError && <p className="error-msg">{authError}</p>}

        {initializing ? (
          <div className="loading-state" style={{ paddingTop: '80px' }}>
            <div className="spinner" />
            <span>Verificando sesión…</span>
          </div>
        ) : !firebaseToken ? (
          <div className="auth-page page-enter">
            <div className="auth-hero">
              <h1 className="auth-title">Tickets de Movimiento</h1>
              <p className="auth-subtitle">Genera tickets de entrada o salida de inventario con aprobación del administrador.</p>
            </div>
            <FirebaseAuthPanel onTokenReceived={(token) => { setFirebaseToken(token); setStep(1) }} onError={setAuthError} />
          </div>
        ) : view === 'admin' ? (
          <AdminPanel
            apiBase={API_BASE}
            firebaseToken={firebaseToken}
            currentUserEmail={firebaseUser?.email || ''}
            onBack={() => { window.location.hash = 'ticket'; setView('ticket') }}
          />
        ) : view === 'history' ? (
          <HistoryPanel
            apiBase={API_BASE}
            firebaseToken={firebaseToken}
            onBack={() => { window.location.hash = 'ticket'; setView('ticket') }}
          />
        ) : (
          <div className="ticket-page page-enter">
            <div className="page-header">
              <h1 className="page-title">Tickets de Movimiento</h1>
              <p className="page-subtitle">Crea un ticket de entrada o salida con aprobación del administrador.</p>
            </div>

            <div className="ticket-layout">
              {/* ── Main column ── */}
              <div className="ticket-main-col">
                <div className="progress-bar">
                  {STEPS.map((label, i) => (
                    <div key={i} className={`progress-step ${i < step ? 'done' : ''} ${i === step ? 'current' : ''}`}>
                      <div className="progress-dot">{i < step ? '✓' : i + 1}</div>
                      <span>{label}</span>
                    </div>
                  ))}
                  <div className="progress-line">
                    <div className="progress-fill" style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
                  </div>
                </div>

                {step === 1 && (
                  <TicketForm
                    apiBase={API_BASE}
                    firebaseToken={firebaseToken}
                    onSubmit={handleSubmit}
                    submitting={submitting}
                    submitError={submitError}
                  />
                )}

                {step === 2 && ticketId && (
                  <StepResult
                    ticketId={ticketId}
                    area={area}
                    ticketType={ticketType}
                    selectedItems={selectedItems}
                    reason={reason}
                    firma={firma}
                    destino={destino}
                    apiBase={API_BASE}
                    firebaseToken={firebaseToken}
                    onReset={reset}
                  />
                )}
              </div>

              {/* ── Sidebar ── */}
              <aside className="ticket-sidebar">
                <div className="sidebar-card">
                  <div className="sidebar-card-header">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>Proceso de aprobación</span>
                  </div>
                  <ol className="sidebar-steps">
                    <li className={`sidebar-step ${step >= 1 ? 'done' : ''} ${step === 1 ? 'current' : ''}`}>
                      <div className="sidebar-step-dot">1</div>
                      <div>
                        <strong>Crea el ticket</strong>
                        <p>Selecciona el área, tipo de movimiento y los productos involucrados.</p>
                      </div>
                    </li>
                    <li className={`sidebar-step ${step >= 2 ? 'done' : ''}`}>
                      <div className="sidebar-step-dot">2</div>
                      <div>
                        <strong>Revisión del administrador</strong>
                        <p>El administrador recibe una notificación y revisa tu solicitud.</p>
                      </div>
                    </li>
                    <li className="sidebar-step">
                      <div className="sidebar-step-dot">3</div>
                      <div>
                        <strong>Confirmación</strong>
                        <p>Recibirás un correo con el resultado y podrás descargar el ticket.</p>
                      </div>
                    </li>
                  </ol>
                </div>

                <div className="sidebar-card sidebar-tips">
                  <div className="sidebar-card-header">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span>Consejos</span>
                  </div>
                  <ul className="sidebar-tip-list">
                    <li>Especifica la cantidad exacta de cada producto.</li>
                    <li>Indica el motivo del movimiento con claridad.</li>
                    <li>Verifica el área antes de enviar.</li>
                  </ul>
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>
    </div>
    </ToastProvider>
  )
}

export default App

