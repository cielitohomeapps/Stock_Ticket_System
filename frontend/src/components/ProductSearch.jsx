import React, { useState, useEffect, useMemo } from 'react'
import {
  normalizeText,
  escapeRegExp,
  getProductId,
  getProductName,
  getProductStock,
} from '../utils/productHelpers'

function highlightMatch(text, query) {
  if (!query) return text
  const escaped = escapeRegExp(query)
  const regex = new RegExp(`(${escaped})`, 'gi')
  return text.split(regex).map((segment, idx) => (
    idx % 2 === 1
      ? <mark key={idx}>{segment}</mark>
      : <span key={idx}>{segment}</span>
  ))
}

export const ProductSearch = ({ products, onSelect, selectedProductIds = [] }) => {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const normalizedQuery = useMemo(() => normalizeText(query), [query])
  const selectedIds = useMemo(() => new Set(selectedProductIds), [selectedProductIds])

  const matchingProducts = useMemo(() => {
    if (!normalizedQuery) return []
    return products
      .filter((product) => {
        const name = normalizeText(getProductName(product)) || ''
        const id = normalizeText(getProductId(product)) || ''
        return name.includes(normalizedQuery) || id.includes(normalizedQuery)
      })
  }, [products, normalizedQuery])
  const results = useMemo(() => matchingProducts.slice(0, 10), [matchingProducts])

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
    if (event.key === 'Escape') {
      setQuery('')
    } else if (!results.length) {
      return
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const product = results[activeIndex]
      if (product) handleSelect(product)
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
          aria-autocomplete="list"
          aria-controls="product-search-results"
          aria-expanded={results.length > 0}
        />
        {query && (
          <button type="button" className="clear-search" onClick={() => setQuery('')}>
            ✕
          </button>
        )}
      </div>
      {query && (
        <div className="search-meta">
          {matchingProducts.length > 0
            ? `Mostrando ${results.length < matchingProducts.length ? `los primeros ${results.length} de ${matchingProducts.length}` : results.length} resultado${matchingProducts.length === 1 ? '' : 's'}`
            : 'No se encontraron productos'}
        </div>
      )}
      {results.length > 0 && (
        <ul className="search-results" id="product-search-results" role="listbox">
          {results.map((product, index) => {
            const id = getProductId(product)
            const name = getProductName(product)
            return (
              <li
                key={id || index}
                className={`${index === activeIndex ? 'active' : ''}${selectedIds.has(id) ? ' selected' : ''}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={() => handleSelect(product)}
              >
                <div className="search-result-main">
                  <div className="result-label">{highlightMatch(name, query)}</div>
                  {id && <div className="result-subtitle">ID: {id}</div>}
                </div>
                <div className="search-result-meta">
                  <span className="search-result-stock">Stock: {getProductStock(product)}</span>
                  <span className={`search-result-action${selectedIds.has(id) ? ' added' : ''}`}>
                    {selectedIds.has(id) ? 'Agregado' : 'Agregar'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}