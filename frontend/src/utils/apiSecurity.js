export function buildApiUrl(apiBase, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001F\u007F]/.test(path)) {
    throw new TypeError('La ruta de API debe ser relativa y válida.')
  }
  return `${String(apiBase || '/api').replace(/\/$/, '')}${path}`
}
