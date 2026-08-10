import React, { useState, useEffect } from 'react'
import logoCH from '../assets/logoch.jpeg'
import { ProductSearch } from './ProductSearch'
import { apiFetchJson } from '../services/apiClient'
import {
  normalizeArea,
  unwrapTypedValue,
  getProductId,
  getProductName,
  getProductStock,
  getProductArea,
  flattenProduct,
} from '../utils/productHelpers'

// ─── Logo Cielito Home ────────────────────────────────────────────────────────
function CielitoHomeLogo() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <img src={logoCH} alt="Cielito Home" style={{ height: '72px', objectFit: 'contain' }} />
    </div>
  )
}

// ---- Search bar for products (optional) ───────────────────────────────────────────────


// ─── Main component ───────────────────────────────────────────────────────────
/**
 * TicketForm
 *
 * Props:
 * @param {string}   apiBase        - Base URL of the backend API
 * @param {string}   firebaseToken  - Firebase ID token for authenticated requests
 * @param {function} onSubmit       - Called with form data when user confirms the ticket
 * @param {boolean}  submitting     - True while the API call is in flight
 * @param {string}   submitError    - Error message to display, if any
 */
export default function TicketForm({
  apiBase,
  firebaseToken,
  onSubmit,
  submitting,
  submitError,
  initialData,
}) {
  const today = new Date().toISOString().split('T')[0]

  // ── Area ──
  const [areas, setAreas] = useState([])
  const [loadingAreas, setLoadingAreas] = useState(true)
  const [areasError, setAreasError] = useState('')
  const [area, setArea] = useState(initialData?.metadata?.area || '')
  const [locationOptions, setLocationOptions] = useState([])

  // ── Ticket type ──
  const [ticketType, setTicketType] = useState(initialData?.type || 'EXIT')

  // ── Date ──
  const [fecha, setFecha] = useState(initialData?.metadata?.fecha || today)

  // ── Products ──
  const [products, setProducts] = useState([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [productsError, setProductsError] = useState(null)
  
  // Format initial items correctly
  const initItems = (initialData?.items || []).map(i => ({
    productId: i.productId || i.id,
    name: i.nombre || i.name || i.productId || i.id,
    qty: i.qty || 1
  }));
  const [selectedItems, setSelectedItems] = useState(initItems)

  // ── Form fields ──
  const [reason, setReason] = useState(initialData?.metadata?.motivo || '')
  const [firma, setFirma] = useState(initialData?.metadata?.firma || '')
  const [destino, setDestino] = useState(initialData?.metadata?.destino || '')

  // ── Fetch areas ──
  useEffect(() => {
    if (!firebaseToken) return
    setLoadingAreas(true)
    setAreasError('')

    const tokenSlice = String(firebaseToken).slice(0, 24)
    const cacheKey = `areas:${apiBase}:${tokenSlice}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached)
        if (Date.now() - Number(parsed?.savedAt || 0) < 60_000 && Array.isArray(parsed?.areas)) {
          setAreas(parsed.areas)
          if (!area && parsed.areas.length > 0) setArea(parsed.areas[0])
          setLoadingAreas(false)
          return
        }
      } catch { /* ignore */ }
    }

    let active = true
    apiFetchJson('/inventory/areas')
      .then((data) => {
        if (!active) return
        const invList = Array.isArray(data?.areas) ? data.areas : []
        setAreas(invList)
        if (!area && invList.length > 0) setArea(invList[0])
        sessionStorage.setItem(cacheKey, JSON.stringify({ areas: invList, savedAt: Date.now() }))
      })
      .catch((err) => { if (active) setAreasError(err.message) })
      .finally(() => { if (active) setLoadingAreas(false) })

    return () => { active = false }
  }, [apiBase, firebaseToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch location suggestions for destination input ──
  useEffect(() => {
    if (!firebaseToken) return

    let active = true
    apiFetchJson('/locations')
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.locations) ? data.locations.map((item) => item.name).filter(Boolean) : []
        setLocationOptions(list)
      })
      .catch(() => {})

    return () => { active = false }
  }, [firebaseToken])

  // ── Fetch products when area changes ──
  useEffect(() => {
    if (!firebaseToken || !area) return
    setLoadingProducts(true)
    setProductsError(null)
    setSelectedItems([])

    let active = true
    apiFetchJson(`/inventory/products?area=${encodeURIComponent(area)}`)
      .then((data) => {
        if (!active) return
        const rawList =
          Array.isArray(data) ? data
          : Array.isArray(data?.data) ? data.data
          : Array.isArray(data?.products) ? data.products
          : Array.isArray(data?.data?.products) ? data.data.products
          : Array.isArray(data?.items) ? data.items
          : []

        const normalized = normalizeArea(area)
        const flattened = rawList
          .map(flattenProduct)
          .filter((item) => {
            const itemArea = getProductArea(item)
            // Keep item if it has no area field (API already filtered) or area matches
            if (!itemArea) return true
            return normalizeArea(itemArea) === normalized
          })

        if (flattened.length > 0) {
          console.debug('[TicketForm] Product keys:', Object.keys(flattened[0]).join(', '))
          console.debug('[TicketForm] Sample product:', flattened[0])
        }
        setProducts(flattened)
      })
      .catch((err) => { if (active) setProductsError(err.message) })
      .finally(() => { if (active) setLoadingProducts(false) })

    return () => { active = false }
  }, [area, apiBase, firebaseToken])

  // ── Product selection handlers ──
  const toggleItem = (product) => {
    const id = getProductId(product)
    setSelectedItems((prev) => {
      const exists = prev.find((i) => i.productId === id)
      if (exists) return prev.filter((i) => i.productId !== id)
      return [...prev, { productId: id, name: getProductName(product), qty: 1 }]
    })
  }

  const setQty = (productId, qty) => {
    setSelectedItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, qty: Math.max(1, Number(qty)) } : i))
    )
  }

  const isSelected = (product) => !!selectedItems.find((i) => i.productId === getProductId(product))
  const getQty = (product) => selectedItems.find((i) => i.productId === getProductId(product))?.qty ?? 1

  const valid = area.trim() && selectedItems.length > 0 && reason.trim() && firma.trim() && destino.trim()

  const handleConfirmar = () => {
    if (!valid || submitting) return
    onSubmit({ area, ticketType, fecha, selectedItems, reason, firma, destino })
  }

  // ── Colors per ticket type ──
  const typeColor = ticketType === 'EXIT' ? '#c0392b' : '#1a6b4a'

  return (
    <div className="ticket-card">

      {/* ── Header ── */}
      <div className="ticket-header">
        <div className="ticket-header-badge">
          <span>Ticket de {ticketType === 'EXIT' ? 'Salida' : 'Entrada'}</span>
        </div>
        {fecha && <span className="ticket-header-date">{fecha}</span>}
      </div>

      <div className="ticket-body">

        {/* ── Área title ── */}
        <p className="ticket-area-title">
          {loadingAreas
            ? <span style={{ color: 'var(--text-muted)', fontSize: '14px', fontStyle: 'italic' }}>Cargando área…</span>
            : `Área: ${area || '—'}`}
        </p>

        {/* ── Area selector ── */}
        {!loadingAreas && (
          <div style={{ marginBottom: '4px' }}>
            <p className="ticket-section-label">Selecciona el área</p>
            {areasError && (
              <p style={{ color: 'var(--red)', fontSize: '12px', marginBottom: '6px' }}>
                Error cargando áreas: {areasError}
              </p>
            )}
            {areas.length > 0 && (
              <div className="area-pills">
                {areas.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setArea(a)}
                    className={`area-pill${area === a ? ' active' : ''}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
            {areas.length === 0 && !areasError && (
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="Escribe el área…"
                className="field-inline-input"
                style={{ flex: 'none', width: '100%' }}
              />
            )}
          </div>
        )}

        {/* ── Tipo de movimiento + Fecha ── */}
        <div className="ticket-controls">
          <div className="type-toggle">
            {[
              { value: 'EXIT', label: 'Salida' },
              { value: 'ENTRY', label: 'Entrada' },
            ].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTicketType(value)}
                className={`toggle-btn${ticketType === value ? ` active ${value === 'EXIT' ? 'exit' : 'entry'}` : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="date-field">
            <label>Fecha:</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>

        {/* ── Grid: productos (izq) + logo/firma (der) ── */}
        <div className="ticket-main-grid">

          {/* Productos */}
          <div>
            <ProductSearch products={products} onSelect={(product) => toggleItem(product)} />
            <p className="ticket-section-label">Productos</p>
            {loadingProducts && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px', padding: '12px 0' }}>
                <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                Cargando productos de {area}…
              </div>
            )}
            {!loadingProducts && productsError && (
              <p style={{ color: 'var(--red)', fontSize: '13px' }}>Error: {productsError}</p>
            )}
            {!loadingProducts && !productsError && products.length === 0 && area && (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic', padding: '16px 0' }}>
                No hay productos para esta área.
              </p>
            )}
            {!loadingProducts && products.length > 0 && (
              <div className="products-list">
                {products.map((product) => {
                  const id = getProductId(product)
                  const selected = isSelected(product)
                  return (
                    <div
                      key={id}
                      className={`product-row${selected ? ' selected' : ''}`}
                      onClick={() => toggleItem(product)}
                    >
                      <div className="product-bullet" />
                      <div className="product-chip">
                        <span>{getProductName(product)}</span>
                        <span className="product-stock">Stock: {getProductStock(product)}</span>
                      </div>
                      {selected && (
                        <input
                          type="number"
                          min="1"
                          value={getQty(product)}
                          className="qty-input"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { e.stopPropagation(); setQty(id, e.target.value) }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {selectedItems.length > 0 && (
              <div className="products-selected-count">
                ✓ {selectedItems.length} producto(s) seleccionado(s)
              </div>
            )}
          </div>

          {/* Logo + firma */}
          <div className="ticket-side">
            <CielitoHomeLogo />
            <div className="firma-field">
              <span className="firma-label">Firma responsable</span>
              <input
                type="text"
                value={firma}
                onChange={(e) => setFirma(e.target.value.slice(0, 200))}
                placeholder="Nombre completo"
                className="firma-input"
                maxLength={200}
              />
            </div>
          </div>
        </div>

        {/* ── Razón + Destino ── */}
        <div className="field-inline">
          <span className="field-inline-label">Razón:</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="Motivo del movimiento"
            className="field-inline-input"
            maxLength={500}
          />
        </div>
        <div className="field-inline">
          <span className="field-inline-label">Destino:</span>
          <input
            type="text"
            value={destino}
            onChange={(e) => setDestino(e.target.value.slice(0, 200))}
            placeholder="Ej. Jesus Maria o JESUS MARIA"
            className="field-inline-input"
            maxLength={200}
            list="ticket-location-options"
          />
          <datalist id="ticket-location-options">
            {locationOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <div className="ticket-divider" />

        {submitError && (
          <p className="error-msg" style={{ marginBottom: '12px' }}>{submitError}</p>
        )}

        {/* ── Submit ── */}
        <div className="ticket-submit-area">
          <button
            className="btn-submit"
            onClick={handleConfirmar}
            disabled={!valid || submitting}
          >
            {submitting ? (
              <>
                <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
                Enviando…
              </>
            ) : (
              'Confirmar borrador →'
            )}
          </button>
          {!valid && !submitting && (
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
              Completa área, productos, razón, destino y firma para continuar.
            </p>
          )}
        </div>

      </div>
    </div>
  )
}
