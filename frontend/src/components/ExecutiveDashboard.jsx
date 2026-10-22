import React, { useState, useEffect } from 'react'

const ChevronIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
)

const TrendUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>
  </svg>
)

const CheckCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>
  </svg>
)

const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3.05h16.94a2 2 0 0 0 1.71-3.05L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
)

const BarChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line>
  </svg>
)

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

function deepFindScalar(obj, matcher, depth = 0, maxDepth = 4) {
  if (!obj || depth > maxDepth) return null

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindScalar(item, matcher, depth + 1, maxDepth)
      if (found !== null && found !== undefined) return found
    }
    return null
  }

  if (typeof obj !== 'object') return null

  for (const [key, value] of Object.entries(obj)) {
    if (matcher(key)) {
      const unwrapped = unwrapTypedValue(value)
      if (typeof unwrapped === 'string' || typeof unwrapped === 'number') return unwrapped
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = deepFindScalar(value, matcher, depth + 1, maxDepth)
      if (found !== null && found !== undefined) return found
    }
  }

  return null
}

function getProductId(p) {
  const directId =
    p?._id ||
    p?.id ||
    p?.productId ||
    p?.productoId ||
    p?.producto_id ||
    p?.sku ||
    p?.code ||
    p?.codigo ||
    p?.productID ||
    p?.product_id

  if (directId) return directId

  const deepId = deepFindScalar(p, (key) => {
    const normalized = String(key).toLowerCase()
    return normalized === 'id' ||
      normalized === 'productid' ||
      normalized === 'producto_id' ||
      normalized === 'productoId' ||
      normalized === 'sku' ||
      normalized.includes('codigo') ||
      normalized.includes('code')
  })

  return deepId
}

function getProductName(p) {
  if (typeof p === 'string' || typeof p === 'number' || typeof p === 'boolean') {
    return asText(p) || 'Sin nombre'
  }

  const candidates = [
    p?.nombre,
    p?.Nombre,
    p?.name,
    p?.Name,
    p?.productName,
    p?.productname,
    p?.productoNombre,
    p?.producto_nombre,
    p?.nombreProducto,
    p?.nombre_producto,
    p?.Producto,
    p?.producto,
    p?.Dispositivo,
    p?.dispositivo,
    p?.itemName,
    p?.descripcion,
    p?.description,
    p?.titulo,
    p?.title,
    p?.fields?.nombre,
    p?.fields?.name,
    p?.data?.nombre,
    p?.data?.name,
    p?.data?.productName,
    p?.data?.productoNombre,
  ]

  for (const v of candidates) {
    const t = asText(unwrapTypedValue(v))
    if (t) return t
  }

  const nestedCandidates = [
    p?.item?.nombre,
    p?.item?.name,
    p?.producto?.nombre,
    p?.producto?.name,
    p?.product?.nombre,
    p?.product?.name,
    p?.data?.item?.nombre,
    p?.data?.item?.name,
    p?.data?.producto?.nombre,
    p?.data?.producto?.name,
    p?.fields?.item?.nombre,
    p?.fields?.item?.name,
  ]

  for (const v of nestedCandidates) {
    const t = asText(unwrapTypedValue(v))
    if (t) return t
  }

  const deepName = deepFindScalar(p, (key) => {
    const normalized = String(key).toLowerCase()
    if (normalized.includes('id') || normalized.includes('sku') || normalized.includes('codigo')) return false
    return (
      normalized === 'nombre' ||
      normalized === 'name' ||
      normalized === 'nombreproducto' ||
      normalized === 'productname' ||
      normalized.includes('nombre') ||
      normalized.includes('name') ||
      normalized.includes('descripcion') ||
      normalized.includes('description') ||
      normalized.includes('title') ||
      normalized.includes('titulo')
    )
  })

  const deepNameText = asText(deepName)
  if (deepNameText) return deepNameText

  return asText(getProductId(p)) || 'Sin nombre'
}

export default function ExecutiveDashboard({ apiBase, firebaseToken, onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

useEffect(() => {
  if (!firebaseToken) return
  setLoading(true)
  setError(null)

  fetch(`${apiBase}/reports/executive`, {
    headers: { Authorization: `Bearer ${firebaseToken}` }
  })
    .then(r => r.json())
    .then(async (d) => {
      if (d.error) throw new Error(d.error)

      // Enriquecer solo cuando el nombre real no está disponible
      const enriched = await Promise.all(
        d.topProducts.map(async (p) => {
          if (getProductName(p) !== asText(getProductId(p))) {
            return p
          }

          const id = p.productId || p._id || p.id
          if (!id) return p

          try {
            const res = await fetch(`${apiBase}/inventory/products/${id}`, {
              headers: { Authorization: `Bearer ${firebaseToken}` }
            })
            if (!res.ok) throw new Error('No se encontró el producto')
            const product = await res.json()
            return {
              ...p,
              name: getProductName(product)
            }
          } catch {
            return p
          }
        })
      )

      setData({ ...d, topProducts: enriched })
    })
    .catch(e => setError(e.message))
    .finally(() => setLoading(false))
}, [apiBase, firebaseToken])

  if (loading) {
    return (
      <div className="dashboard-page">
        <div style={{ paddingTop: '120px', textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          <span style={{ color: 'var(--text-muted)' }}>Cargando reportes ejecutivos…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dashboard-page">
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="btn-back" onClick={onBack}>← Volver</button>
            <h1 className="page-title">Dashboard Ejecutivo</h1>
          </div>
        </div>
        <p style={{ color: 'var(--red)', padding: '20px' }}>Error: {error}</p>
      </div>
    )
  }

  if (!data) return null

  const { summary, topProducts, topDestinations, monthlyStats } = data
  const maxProduct = Math.max(...topProducts.map(p => p.totalQty), 1)
  const maxDestination = Math.max(...topDestinations.map(d => d.ticketCount), 1)
  const maxMonth = Math.max(...monthlyStats.map(m => m.totalItems), 1)
  console.log('topProducts[0]:', JSON.stringify(topProducts[0], null, 2))

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="btn-back" onClick={onBack}>← Volver</button>
          <h1 className="page-title">Dashboard Ejecutivo</h1>
        </div>
        <p className="page-subtitle">Métricas clave de movimiento de inventario</p>
      </div>

      {/* ── KPI Cards ── */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Total Tickets</span>
            <BarChartIcon />
          </div>
          <div className="kpi-value">{summary.totalTickets}</div>
          <div className="kpi-meta">Todos los movimientos</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Productos Movidos</span>
            <TrendUpIcon />
          </div>
          <div className="kpi-value">{summary.totalItems}</div>
          <div className="kpi-meta">Unidades totales</div>
        </div>

        <div className="kpi-card" style={{ backgroundColor: '#e8f5e9' }}>
          <div className="kpi-header">
            <span className="kpi-label">Tasa Aprobación</span>
            <CheckCircleIcon />
          </div>
          <div className="kpi-value" style={{ color: '#2e7d32' }}>{summary.approvalRate}%</div>
          <div className="kpi-meta">Tickets completados</div>
        </div>

        <div className="kpi-card" style={{ backgroundColor: '#fff3e0' }}>
          <div className="kpi-header">
            <span className="kpi-label">Pendientes</span>
            <AlertIcon />
          </div>
          <div className="kpi-value" style={{ color: '#e65100' }}>{summary.pendingCount}</div>
          <div className="kpi-meta">En revisión</div>
        </div>

        <div className="kpi-card" style={{ backgroundColor: '#ffebee' }}>
          <div className="kpi-header">
            <span className="kpi-label">Rechazados</span>
            <AlertIcon />
          </div>
          <div className="kpi-value" style={{ color: '#c62828' }}>{summary.rejectionRate}%</div>
          <div className="kpi-meta">Tasa de rechazo</div>
        </div>
      </div>

      {/* ── TOP PRODUCTS ── */}
      <section className="dashboard-section">
        <h2 className="section-title">
          <BarChartIcon /> Productos Más Movidos
        </h2>
        <div className="chart-container">
          {topProducts.length > 0 ? (
            <div className="horizontal-bar-chart">
              {topProducts.map((product, idx) => (
                <div key={idx} className="bar-item">
                  <div className="bar-label">
                    <span className="bar-name">{getProductName(product)}</span>
                    <span className="bar-value">{product.totalQty} unidades</span>
                  </div>
                  <div className="bar-track">
                    <div
                      style={{
                        width: `${(product.totalQty / maxProduct) * 100}%`,
                        background: `linear-gradient(90deg, #2b8cff, #1565c0)`
                      }}
                    />
                  </div>
                  <div className="bar-meta">{product.ticketCount} tickets</div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
              No hay datos disponibles
            </p>
          )}
        </div>
      </section>

      {/* ── TOP DESTINATIONS ── */}
      <section className="dashboard-section">
        <h2 className="section-title">
          <BarChartIcon /> Destinos Más Frecuentes
        </h2>
        <div className="chart-container">
          {topDestinations.length > 0 ? (
            <div className="destinations-list">
              {topDestinations.map((dest, idx) => (
                <div key={idx} className="destination-card">
                  <div className="dest-header">
                    <div className="dest-title">
                      <span className="dest-name">{dest.destination}</span>
                      <span className="dest-badge">{dest.ticketCount} tickets</span>
                    </div>
                    <div className="dest-stats">
                      <div className="stat-item">
                        <span className="stat-label">Productos</span>
                        <span className="stat-value">{dest.uniqueProducts}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Cantidad</span>
                        <span className="stat-value">{dest.totalItems}</span>
                      </div>
                    </div>
                  </div>

                  <div className="dest-bar-container">
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${(dest.ticketCount / maxDestination) * 100}%`,
                          background: `linear-gradient(90deg, #ff9800, #e65100)`
                        }}
                      />
                    </div>
                  </div>

                  {dest.products && dest.products.length > 0 && (
                    <div className="dest-products">
                      <span className="products-label">Productos enviados:</span>
                      <div className="products-tags">
                        {dest.products.map((product, pidx) => (
                          <span key={pidx} className="product-tag">{getProductName(product)}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
              No hay datos disponibles
            </p>
          )}
        </div>
      </section>

      {/* ── MONTHLY STATS ── */}
      <section className="dashboard-section">
        <h2 className="section-title">
          <BarChartIcon /> Movimientos Mensuales
        </h2>
        <div className="chart-container">
          {monthlyStats.length > 0 ? (
            <div className="monthly-chart">
              {monthlyStats.map((month, idx) => (
                <div key={idx} className="month-card">
                  <div className="month-label">{month.month}</div>
                  <div className="month-bars">
                    <div className="month-bar-item">
                      <div className="month-bar-track">
                        <div
                          className="month-bar-fill"
                          style={{
                            height: `${(month.totalItems / maxMonth) * 100}%`,
                            background: 'linear-gradient(180deg, #2b8cff, #1565c0)'
                          }}
                        />
                      </div>
                      <div className="month-bar-label">{month.totalItems}</div>
                    </div>
                  </div>
                  <div className="month-meta">
                    <div><strong>{month.uniqueLocations}</strong> ubicaciones</div>
                    <div><strong>{month.uniqueProducts}</strong> productos</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
              No hay datos disponibles
            </p>
          )}
        </div>
      </section>

      <style>{`
        .dashboard-page {
          padding: 24px;
          max-width: 1400px;
          margin: 0 auto;
        }

        .page-header {
          margin-bottom: 32px;
        }

        .page-title {
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .page-subtitle {
          color: var(--text-muted);
          margin: 4px 0 0 0;
          font-size: 14px;
        }

        .btn-back {
          background: none;
          border: none;
          padding: 6px 8px;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.2s;
          border-radius: 4px;
        }

        .btn-back:hover {
          background: var(--bg-secondary);
          color: var(--text-primary);
        }

        /* KPI Grid */
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 40px;
        }

        .kpi-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 20px;
          transition: all 0.3s;
        }

        .kpi-card:hover {
          border-color: #2b8cff;
          box-shadow: 0 4px 12px rgba(43, 140, 255, 0.1);
        }

        .kpi-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .kpi-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .kpi-header svg {
          color: #2b8cff;
        }

        .kpi-value {
          font-size: 32px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 8px 0;
        }

        .kpi-meta {
          font-size: 12px;
          color: var(--text-muted);
        }

        /* Sections */
        .dashboard-section {
          margin-bottom: 40px;
        }

        .section-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 20px 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .section-title svg {
          color: #2b8cff;
        }

        .chart-container {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 20px;
        }

        /* Horizontal Bar Chart */
        .horizontal-bar-chart {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .bar-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .bar-label {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .bar-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          max-width: 70%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bar-value {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          background: var(--bg-primary);
          padding: 2px 8px;
          border-radius: 3px;
        }

        .bar-track {
          height: 24px;
          background: var(--bg-primary);
          border-radius: 4px;
          overflow: hidden;
        }

        .bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .bar-meta {
          font-size: 11px;
          color: var(--text-muted);
          text-align: right;
        }

        /* Destinations List */
        .destinations-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .destination-card {
          padding: 16px;
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          transition: all 0.2s;
        }

        .destination-card:hover {
          border-color: #ff9800;
          box-shadow: 0 2px 8px rgba(255, 152, 0, 0.1);
        }

        .dest-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 12px;
        }

        .dest-title {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
        }

        .dest-name {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .dest-badge {
          font-size: 11px;
          font-weight: 600;
          background: linear-gradient(135deg, #ff9800, #e65100);
          color: white;
          padding: 2px 8px;
          border-radius: 12px;
        }

        .dest-stats {
          display: flex;
          gap: 16px;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .stat-label {
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 600;
        }

        .stat-value {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .dest-bar-container {
          margin: 12px 0;
        }

        .dest-products {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-color);
        }

        .products-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          display: block;
          margin-bottom: 6px;
        }

        .products-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .product-tag {
          font-size: 11px;
          padding: 4px 8px;
          background: var(--bg-secondary);
          color: var(--text-muted);
          border-radius: 4px;
          border: 1px solid var(--border-color);
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .monthly-chart {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
          gap: 16px;
        }

        .month-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 16px;
          background: var(--bg-primary);
          border-radius: 6px;
          border: 1px solid var(--border-color);
        }

        .month-label {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .month-bars {
          display: flex;
          align-items: flex-end;
          justify-content: center;
          gap: 8px;
          height: 120px;
          width: 100%;
        }

        .month-bar-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
          flex: 1;
        }

        .month-bar-track {
          width: 100%;
          height: 100%;
          background: var(--bg-secondary);
          border-radius: 3px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }

        .month-bar-fill {
          width: 100%;
          border-radius: 3px 3px 0 0;
        }

        .month-bar-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          margin-top: 4px;
          text-align: center;
        }

        .month-meta {
          font-size: 10px;
          color: var(--text-muted);
          text-align: center;
          width: 100%;
        }

        .month-meta div {
          margin: 2px 0;
        }

        /* Spinner */
        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--bg-secondary);
          border-top-color: #2b8cff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
