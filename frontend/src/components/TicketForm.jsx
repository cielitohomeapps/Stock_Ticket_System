import React, { useState, useEffect, useRef } from 'react'
import { normalizeText } from '../utils/productHelpers'
import logoCH from '../assets/logoch.jpeg'
import { ProductSearch } from './ProductSearch'
import { getAlertDetails } from './AlertBanner'
import { useToast } from './Toast'
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
  onOpenHistory,
  onCreateNewSubmission,
}) {
  const toast = useToast()
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // ── Area ──
  const [areas, setAreas] = useState([])
  const [loadingAreas, setLoadingAreas] = useState(true)
  const [areasError, setAreasError] = useState('')
  const [areasRetry, setAreasRetry] = useState(0)
  const [area, setArea] = useState(initialData?.metadata?.area || '')
  const [locationOptions, setLocationOptions] = useState([])
  const [locationQuery, setLocationQuery] = useState('')
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [locationsError, setLocationsError] = useState(null)
  const [locationsRetry, setLocationsRetry] = useState(0)
  const [unmappedDestination, setUnmappedDestination] = useState('')

  // ── Ticket type ──
  const [ticketType, setTicketType] = useState(initialData?.type || 'EXIT')

  // ── Date ──
  const [fecha, setFecha] = useState(initialData?.metadata?.fecha || today)

  // ── Products ──
  const [products, setProducts] = useState([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [productsError, setProductsError] = useState(null)
  const [productsRetry, setProductsRetry] = useState(0)
  
  // Format initial items correctly
  const initItems = (initialData?.items || []).map(i => ({
    productId: i.productId || i.id,
    name: i.nombre || i.name || i.productId || i.id,
    qty: i.qty || 1
  }));
  const [selectedItems, setSelectedItems] = useState(initItems)
  const previousAreaRef = useRef(area)
  const selectedItemRefs = useRef({})

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
      .catch((err) => { if (active) setAreasError(err) })
      .finally(() => { if (active) setLoadingAreas(false) })

    return () => { active = false }
  }, [apiBase, firebaseToken, areasRetry]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch canonical destinations ──
  useEffect(() => {
    if (!firebaseToken) return

    let active = true
    setLocationsLoading(true)
    setLocationsError(null)
    apiFetchJson('/locations')
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.locations)
          ? data.locations.filter((item) => item?.id && item?.name)
          : []
        setLocationOptions(list)
      })
      .catch((error) => { if (active) setLocationsError(error) })
      .finally(() => { if (active) setLocationsLoading(false) })

    return () => { active = false }
  }, [firebaseToken, locationsRetry])

  useEffect(() => {
    if (!locationsError) return
    toast.alert({
      title: 'No se pudo cargar el catálogo de destinos',
      message: 'Revisa tu conexión e inténtalo de nuevo. No se puede enviar el ticket sin seleccionar una ubicación registrada.',
      type: 'error',
      action: { label: 'Intentar de nuevo', onClick: () => setLocationsRetry((attempt) => attempt + 1) },
    })
  }, [locationsError, toast])

  useEffect(() => {
    if (!locationOptions.length) return
    const currentDestination = initialData?.metadata?.destino || destino
    if (!currentDestination) return
    const normalizedDestination = normalizeText(currentDestination)
    const match = locationOptions.find((location) =>
      [location.name, ...(location.aliases || [])]
        .some((alias) => normalizeText(alias) === normalizedDestination)
    )
    if (match) {
      setDestino(match.name)
      setUnmappedDestination('')
    } else {
      setUnmappedDestination(currentDestination)
      setDestino('')
    }
  }, [initialData, locationOptions])

  // ── Fetch products when area changes ──
  useEffect(() => {
    if (!firebaseToken || !area) return
    setLoadingProducts(true)
    setProductsError(null)
    setProducts([])
    if (previousAreaRef.current && normalizeArea(previousAreaRef.current) !== normalizeArea(area)) {
      setSelectedItems([])
    }
    previousAreaRef.current = area

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

        setProducts(flattened)
      })
      .catch((err) => { if (active) setProductsError(err) })
      .finally(() => { if (active) setLoadingProducts(false) })

    return () => { active = false }
  }, [area, apiBase, firebaseToken, productsRetry])

  useEffect(() => {
    if (!areasError) return
    const alert = getAlertDetails(areasError, 'inventory')
    toast.alert({
      ...alert,
      type: 'error',
      action: { label: 'Intentar de nuevo', onClick: () => setAreasRetry((attempt) => attempt + 1) },
    })
  }, [areasError, toast])

  useEffect(() => {
    if (!productsError) return
    const alert = getAlertDetails(productsError, 'inventory')
    toast.alert({
      ...alert,
      type: 'error',
      action: { label: 'Intentar de nuevo', onClick: () => setProductsRetry((attempt) => attempt + 1) },
    })
  }, [productsError, toast])

  // ── Product selection handlers ──
  const addItem = (product) => {
    const id = getProductId(product)
    if (!id) return
    const name = getProductName(product)
    if (selectedItems.some((item) => item.productId === id)) {
      toast.info(`${name} ya está en el ticket. Puedes cambiar su cantidad en la lista.`)
      selectedItemRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      selectedItemRefs.current[id]?.querySelector('input')?.focus()
      return
    }
    setSelectedItems((prev) => {
      if (prev.some((item) => item.productId === id)) return prev
      return [...prev, { productId: id, name, qty: 1 }]
    })
  }

  const removeItem = (productId) => {
    setSelectedItems((prev) => prev.filter((item) => item.productId !== productId))
    delete selectedItemRefs.current[productId]
  }

  const setQty = (productId, qty) => {
    const normalizedQty = qty === '' ? '' : Number(qty)
    setSelectedItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, qty: normalizedQty } : i))
    )
  }

  const missingFields = [
    !area.trim() && 'área',
    selectedItems.length === 0 && 'al menos un producto',
    selectedItems.some((item) => !Number.isSafeInteger(Number(item.qty)) || Number(item.qty) <= 0) && 'una cantidad entera válida para cada producto',
    !fecha && 'fecha',
    !reason.trim() && 'razón',
    !locationOptions.some((location) => location.name === destino) && 'un destino del catálogo de ubicaciones',
    !firma.trim() && 'firma',
  ].filter(Boolean)
  const valid = missingFields.length === 0
  const selectedLocation = locationOptions.find((location) => location.name === destino)
  const normalizedLocationQuery = normalizeText(locationQuery)
  const locationResults = normalizedLocationQuery
    ? locationOptions.filter((location) =>
      [location.name, ...(location.aliases || [])]
        .some((value) => normalizeText(value).includes(normalizedLocationQuery))
    ).slice(0, 10)
    : []

  const handleConfirmar = () => {
    if (!valid || submitting) {
      if (!submitting && missingFields.length > 0) {
        toast.alert({
          title: 'Revisa los datos del ticket',
          message: `Completa estos campos para continuar: ${missingFields.join(', ')}.`,
          type: 'warning',
        })
      }
      return
    }
    onSubmit({ area, ticketType, fecha, selectedItems, reason, firma, destino })
  }

  useEffect(() => {
    if (!submitError) return
    if (submitError.code === 'IDEMPOTENCY_KEY_REUSED') {
      toast.alert({
        title: 'Hay un envío anterior que debes verificar',
        message: 'Esta solicitud ya se registró con otros datos. Revisa Mis Tickets antes de iniciar un nuevo envío.',
        type: 'warning',
        action: { label: 'Abrir Mis Tickets', onClick: onOpenHistory },
        secondaryAction: {
          label: 'Ya revisé; permitir un nuevo envío',
          onClick: onCreateNewSubmission,
        },
      })
      return
    }

    const alert = getAlertDetails(submitError)
    const canRetry = ['INVENTORY_UNAVAILABLE', 'API_UNAVAILABLE'].includes(submitError.code)
    toast.alert({
      ...alert,
      type: 'error',
      action: canRetry ? { label: 'Intentar de nuevo', onClick: handleConfirmar } : undefined,
    })
  }, [submitError])

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
            <p className="ticket-section-label">Busca y agrega productos</p>
            <ProductSearch
              products={products}
              onSelect={addItem}
              selectedProductIds={selectedItems.map((item) => item.productId)}
            />
            {loadingProducts && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px', padding: '12px 0' }}>
                <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                Cargando productos de {area}…
              </div>
            )}
            {!loadingProducts && !productsError && products.length === 0 && area && (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic', padding: '16px 0' }}>
                No hay productos para esta área.
              </p>
            )}
            <div className="ticket-selected-products">
              <div className="ticket-selected-header">
                <p className="ticket-section-label">Productos del ticket</p>
                <span className="ticket-selected-count">{selectedItems.length}</span>
              </div>
              {selectedItems.length === 0 ? (
                <p className="ticket-selected-empty">Busca un producto y selecciónalo para agregarlo aquí.</p>
              ) : (
                <ul className="ticket-selected-list">
                  {selectedItems.map((item) => {
                    const product = products.find((candidate) => getProductId(candidate) === item.productId)
                    return (
                      <li
                        key={item.productId}
                        className="ticket-selected-item"
                        ref={(element) => {
                          if (element) selectedItemRefs.current[item.productId] = element
                          else delete selectedItemRefs.current[item.productId]
                        }}
                      >
                        <div className="ticket-selected-details">
                          <strong>{item.name || getProductName(product)}</strong>
                          <span>
                            ID: {item.productId}
                            {product ? ` · Stock: ${getProductStock(product)}` : ''}
                          </span>
                        </div>
                        <label className="ticket-selected-quantity">
                          <span>Cantidad</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={item.qty}
                            className="qty-input"
                            aria-label={`Cantidad de ${item.name || item.productId}`}
                            onChange={(event) => setQty(item.productId, event.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="ticket-selected-remove"
                          aria-label={`Quitar ${item.name || item.productId}`}
                          onClick={() => removeItem(item.productId)}
                        >
                          Quitar
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
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
          <div className="destination-picker">
            {selectedLocation ? (
              <div className="destination-selected">
                <span>Destino seleccionado</span>
                <strong>{selectedLocation.name}</strong>
                <button
                  type="button"
                  onClick={() => setDestino('')}
                  aria-label="Cambiar destino"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <input
                  type="search"
                  value={locationQuery}
                  onChange={(event) => {
                    setLocationQuery(event.target.value.slice(0, 200))
                    setDestino('')
                  }}
                  placeholder="Busca una ubicación..."
                  className="field-inline-input"
                  maxLength={200}
                  aria-label="Buscar destino"
                  aria-controls="destination-search-results"
                  aria-expanded={locationResults.length > 0}
                  disabled={locationsLoading || locationOptions.length === 0}
                />
                {locationsLoading && (
                  <p className="destination-hint">Cargando ubicaciones…</p>
                )}
                {locationResults.length > 0 && (
                  <ul className="destination-results" id="destination-search-results">
                    {locationResults.map((location) => (
                      <li key={location.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setDestino(location.name)
                            setLocationQuery('')
                            setUnmappedDestination('')
                          }}
                        >
                          <strong>{location.name}</strong>
                          <span>
                            {location.aliases?.length
                              ? `También: ${location.aliases.slice(0, 3).join(', ')}${location.aliases.length > 3 ? ` y ${location.aliases.length - 3} más` : ''}`
                              : 'Ubicación oficial'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {locationQuery && locationResults.length === 0 && (
                  <p className="destination-hint">
                    No hay coincidencias. Si falta esta ubicación, solicita a un administrador que la agregue.
                  </p>
                )}
                {unmappedDestination && (
                  <p className="destination-hint destination-hint-warning">
                    El destino anterior “{unmappedDestination}” no está asociado al catálogo. Selecciona una ubicación oficial o pide al administrador que agregue ese nombre como alias.
                  </p>
                )}
                {!locationQuery && locationOptions.length === 0 && !locationsError && (
                  <p className="destination-hint">
                    No hay ubicaciones registradas. Solicita a un administrador que configure el catálogo.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="ticket-divider" />

        {/* ── Submit ── */}
        <div className="ticket-submit-area">
          <button
            className="btn-submit"
            onClick={handleConfirmar}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
                Enviando…
              </>
            ) : (
              'Enviar a revisión →'
            )}
          </button>
        </div>

      </div>
    </div>
  )
}
