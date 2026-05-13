import React, { useState } from 'react'
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { auth } from '../config/firebase'
import logoCH from '../assets/logoch.jpeg'

export default function FirebaseAuthPanel({ onTokenReceived, onError }) {
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')
  const isDev = import.meta.env.DEV

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setLocalError('')
    try {
      const provider = new GoogleAuthProvider()
      provider.addScope('profile')
      provider.addScope('email')
      const result = await signInWithPopup(auth, provider)
      const token = await result.user.getIdToken()
      onTokenReceived(token)
    } catch (err) {
      const errorMsg = err.message || 'Error al iniciar sesión con Google'
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

        <button onClick={handleGoogleSignIn} className="btn-google" disabled={loading}>
          {loading ? (
            <>
              <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
              Iniciando sesión…
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Iniciar sesión con Google
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

