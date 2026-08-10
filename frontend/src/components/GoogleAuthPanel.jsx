import React, { useState } from 'react'
import { signInWithPopup, OAuthProvider } from 'firebase/auth'
import { auth } from '../config/firebase'
import logoCH from '../assets/logoch.jpeg'

export default function FirebaseAuthPanel({ onTokenReceived, onError }) {
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')
  const isDev = import.meta.env.DEV && window.location.hostname === 'localhost'

  const handleMicrosoftSignIn = async () => {
    setLoading(true)
    setLocalError('')
    try {
      const provider = new OAuthProvider('microsoft.com')
      provider.addScope('User.Read')
      provider.setCustomParameters({ prompt: 'select_account' })
      const result = await signInWithPopup(auth, provider)
      const token = await result.user.getIdToken()
      onTokenReceived(token)
    } catch (err) {
      const errorMsg = err.message || 'Error al iniciar sesión con Microsoft'
      setLocalError(errorMsg)
      onError?.(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  const handleDevLogin = async () => {
    setLoading(true)
    setLocalError('')
    try {
      const dummyToken = 'dev_token_' + Date.now()
      onTokenReceived(dummyToken)
    } catch (err) {
      setLocalError('Error en login de desarrollo')
      onError?.('Error en login de desarrollo')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="firebase-auth-panel">
      <div className="auth-panel-header">
        <div className="auth-logo-wrap">
          <img src={logoCH} alt="Cielito Home" style={{ height: '56px', objectFit: 'contain', borderRadius: '6px', marginBottom: '8px' }} />
          <span className="auth-logo-name">Cielito Home</span>
          <span className="auth-logo-tag">Gestión de Inventario</span>
        </div>
        <h2>Bienvenido</h2>
      </div>

      <div className="auth-panel-body">
        <p>Inicia sesión para acceder al sistema de tickets de inventario.</p>

        {localError && <p className="error-msg" style={{ marginBottom: '16px' }}>{localError}</p>}

        <button onClick={handleMicrosoftSignIn} className="btn-google" disabled={loading}>
          {loading ? (
            <>
              <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
              Iniciando sesión…
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
              Iniciar sesión con Microsoft
            </>
          )}
        </button>

        {isDev && (
          <>
            <div className="auth-divider">solo desarrollo</div>
            <button
              onClick={handleDevLogin}
              className="btn-secondary"
              style={{ width: '100%' }}
              disabled={loading}
            >
              {loading ? 'Conectando…' : '🧪 Login de Desarrollo'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

