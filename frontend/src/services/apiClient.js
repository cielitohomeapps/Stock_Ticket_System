import { auth } from '../config/firebase'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

let _token = null
let _onAuthLost = null

export function setApiToken(token) {
  _token = token
}

export function setOnAuthLost(cb) {
  _onAuthLost = cb
}

function triggerAuthLost(message) {
  if (_onAuthLost) _onAuthLost(message)
}

async function refreshIdToken() {
  const user = auth.currentUser
  if (!user) throw new Error('No hay usuario autenticado')
  return user.getIdToken(true)
}

export async function apiFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const method = options.method || 'GET'

  const headers = { ...(options.headers || {}) }

  if (_token && !headers.Authorization) {
    headers.Authorization = `Bearer ${_token}`
  }

  const fetchOpts = { ...options, headers, method }

  let res = await fetch(url, fetchOpts)

  if (res.status === 403) {
    const data = await res.json().catch(() => null)
    const msg = data?.error || 'Tu cuenta no está registrada en el sistema. Contacta al administrador.'
    triggerAuthLost(msg)
    throw new Error(msg)
  }

  if (res.status === 401 && _token) {
    try {
      const freshToken = await refreshIdToken()
      _token = freshToken
      headers.Authorization = `Bearer ${freshToken}`
      res = await fetch(url, { ...fetchOpts, headers })
    } catch (refreshErr) {
      triggerAuthLost('Sesión expirada. Por favor, inicia sesión de nuevo.')
      throw new Error('Sesión expirada. Por favor, inicia sesión de nuevo.')
    }
  }

  return res
}

export async function apiFetchJson(path, options = {}) {
  const res = await apiFetch(path, options)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = data?.error || data?.message || `Error ${res.status}`
    throw new Error(msg)
  }
  return data
}

export async function apiDownload(path, filename) {
  const res = await apiFetch(path)
  if (!res.ok) throw new Error('Error al descargar el archivo')
  const blob = await res.blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export { API_BASE }
