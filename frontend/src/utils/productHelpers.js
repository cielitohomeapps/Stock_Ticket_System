export function unwrapTypedValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (typeof value.stringValue === 'string') return value.stringValue
  if (value.integerValue !== undefined) return value.integerValue
  if (value.doubleValue !== undefined) return value.doubleValue
  if (typeof value.booleanValue === 'boolean') return value.booleanValue
  if (value.timestampValue) return value.timestampValue
  if (value.mapValue?.fields) {
    const out = {}
    Object.entries(value.mapValue.fields).forEach(([k, v]) => { out[k] = unwrapTypedValue(v) })
    return out
  }
  if (Array.isArray(value.arrayValue?.values)) return value.arrayValue.values.map(unwrapTypedValue)
  if (value.fields && typeof value.fields === 'object') {
    const out = {}
    Object.entries(value.fields).forEach(([k, v]) => { out[k] = unwrapTypedValue(v) })
    return out
  }
  return value
}

export function asText(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

export function normalizeText(value) {
  return asText(value)
    ?.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function getProductId(p) {
  return p?._id || p?.id || p?.productId || p?.productoId || p?.producto_id
}

export function getProductName(p) {
  const candidates = [
    p?.nombre, p?.Nombre, p?.name, p?.Name,
    p?.Producto, p?.producto, p?.Dispositivo, p?.dispositivo,
    p?.descripcion, p?.description, p?.titulo, p?.title,
  ]
  for (const v of candidates) {
    const t = asText(unwrapTypedValue(v))
    if (t) return t
  }
  return asText(getProductId(p)) || 'Sin nombre'
}

export function normalizeArea(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export const STOCK_KEYS = [
  'stock', 'Stock', 'STOCK',
  'cantidad', 'Cantidad', 'CANTIDAD',
  'existencias', 'Existencias',
  'cantidadDisponible', 'CantidadDisponible',
  'stockActual', 'StockActual',
  'quantity', 'Quantity',
  'qty', 'Qty',
  'inventario', 'Inventario',
  'disponible', 'Disponible', 'disponibles', 'Disponibles',
  'unidades', 'Unidades',
  'totalDisponible', 'TotalDisponible',
  'enStock', 'en_stock',
]

export function getProductStock(p) {
  for (const key of STOCK_KEYS) {
    if (p?.[key] !== undefined && p?.[key] !== null) {
      const n = unwrapTypedValue(p[key])
      if (n !== null && n !== undefined && n !== '') {
        const num = Number(n)
        if (!Number.isNaN(num)) return Number.isInteger(num) ? num : num.toFixed(2)
        return String(n)
      }
    }
  }
  if (p && typeof p === 'object') {
    const stockPattern = /stock|cant|exist|qty|quant|invent|disp|unid/i
    for (const [key, val] of Object.entries(p)) {
      if (stockPattern.test(key)) {
        const n = unwrapTypedValue(val)
        if (n !== null && n !== undefined && n !== '') {
          const num = Number(n)
          if (!Number.isNaN(num)) return Number.isInteger(num) ? num : num.toFixed(2)
        }
      }
    }
  }
  return '—'
}

export function getProductArea(p) {
  return p?.area || p?.Area || p?.departamento || p?.Departamento ||
    p?.categoria || p?.Categoria || p?.sector || p?.Sector
}

export function flattenProduct(item) {
  if (item?.fields && typeof item.fields === 'object') {
    const decoded = unwrapTypedValue({ fields: item.fields }) || {}
    const fallbackId = typeof item.name === 'string' ? item.name.split('/').pop() : undefined
    return { id: item.id || item._id || fallbackId, ...decoded }
  }
  if (item?.data && typeof item.data === 'object' && !Array.isArray(item.data)) {
    return { id: item.id || item._id || item.data.id, ...item.data }
  }
  return item
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
