import { auth } from '../config/firebase'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

let _token = null
let _onAuthLost = null

export class ApiError extends Error {
  constructor(message, { status, code, requestId } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

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

async function fetchWithNetworkError(url, options) {
  try {
    return await fetch(url, options)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError(
        'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
        { code: 'API_UNAVAILABLE' }
      )
    }
    throw error
  }
}

export async function apiFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  const method = options.method || 'GET'

  const headers = { ...(options.headers || {}) }

  if (_token && !headers.Authorization) {
    headers.Authorization = `Bearer ${_token}`
  }

  const fetchOpts = { ...options, headers, method }

  let res = await fetchWithNetworkError(url, fetchOpts)

  if (res.status === 403) {
    const data = await res.json().catch(() => null)
    const msg = data?.error || 'No tienes permiso para realizar esta operación.'
    if (data?.code === 'USER_NOT_REGISTERED') triggerAuthLost(msg)
    throw new ApiError(msg, { status: res.status, code: data?.code, requestId: data?.requestId })
  }

  if (res.status === 401 && _token) {
    try {
      const freshToken = await refreshIdToken()
      _token = freshToken
      headers.Authorization = `Bearer ${freshToken}`
      res = await fetchWithNetworkError(url, { ...fetchOpts, headers })
    } catch (refreshErr) {
      if (refreshErr instanceof ApiError && refreshErr.code === 'API_UNAVAILABLE') throw refreshErr
      triggerAuthLost('Sesión expirada. Por favor, inicia sesión de nuevo.')
      throw new ApiError('Sesión expirada. Por favor, inicia sesión de nuevo.', { status: 401, code: 'SESSION_EXPIRED' })
    }
  }

  return res
}

export async function apiFetchJson(path, options = {}) {
  const res = await apiFetch(path, options)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const base = data?.error || data?.message || `Error ${res.status}`
    const detail = Array.isArray(data?.details) && data.details.length ? ` ${data.details.slice(0, 3).join(' ')}` : ''
    const msg = `${base}${detail}`
    throw new ApiError(msg, {
      status: res.status,
      code: data?.code,
      requestId: data?.requestId,
    })
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
