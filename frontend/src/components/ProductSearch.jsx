import React, { useState, useEffect, useMemo } from 'react'

// --- Small product helpers (copied from TicketForm.jsx to avoid circular imports)
function unwrapTypedValue(value) {
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

function asText(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

function normalizeText(value) {
  return asText(value)
    ?.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0000-\u001F\u007F-\u007F]/g, '')
    .replace(/[\u0300-\u036f]/g, '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
}

function highlightMatch(text, query) {
  if (!query) return text
  const escaped = escapeRegExp(query)
  const regex = new RegExp(`(${escaped})`, 'gi')
  return text.split(regex).map((segment, idx) => (
    regex.test(segment)
      ? <mark key={idx}>{segment}</mark>
      : <span key={idx}>{segment}</span>
  ))
}

function getProductId(p) {
  return p?._id || p?.id || p?.productId || p?.productoId || p?.producto_id
}

function getProductName(p) {
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

export const ProductSearch = ({ products, onSelect }) => {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const normalizedQuery = useMemo(() => normalizeText(query), [query])

  const results = useMemo(() => {
    if (!normalizedQuery) return []
    return products
      .filter((product) => {
        const name = normalizeText(getProductName(product)) || ''
        const id = normalizeText(getProductId(product)) || ''
        return name.includes(normalizedQuery) || id.includes(normalizedQuery)
      })
      .slice(0, 10)
  }, [products, normalizedQuery])

  useEffect(() => {
    setActiveIndex((current) => {
      if (results.length === 0) return 0
      return current < results.length ? current : 0
    })
  }, [results.length])

  const handleSelect = (product) => {
    onSelect(product)
    setQuery('')
  }

  const handleKeyDown = (event) => {
    if (!results.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const product = results[activeIndex]
      if (product) handleSelect(product)
    } else if (event.key === 'Escape') {
      setQuery('')
    }
  }

  return (
    <div className="product-search">
      <div className="search-input-row">
        <input
          type="text"
          placeholder="Buscar por nombre o ID..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Buscar producto"
        />
        {query && (
          <button type="button" className="clear-search" onClick={() => setQuery('')}>
            ✕
          </button>
        )}
      </div>
      {query && (
        <div className="search-meta">
          {results.length > 0
            ? `Mostrando ${results.length} producto${results.length === 1 ? '' : 's'}`
            : 'No se encontraron productos'}
        </div>
      )}
      {results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((product, index) => {
            const id = getProductId(product)
            const name = getProductName(product)
            return (
              <li
                key={id || index}
                className={index === activeIndex ? 'active' : ''}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={() => handleSelect(product)}
              >
                <div className="result-label">{highlightMatch(name, query)}</div>
                {id && <div className="result-subtitle">ID: {id}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}