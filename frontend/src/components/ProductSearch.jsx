import React, { useState, useEffect, useMemo } from 'react'
import {
  unwrapTypedValue,
  asText,
  normalizeText,
  escapeRegExp,
  getProductId,
  getProductName,
} from '../utils/productHelpers'

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