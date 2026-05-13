import React, { useEffect, useState } from 'react'

export default function StepItems({ area, apiBase, userId, userRole, firebaseToken, selectedItems, setSelectedItems, onNext, onBack }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const getProductId = (product) =>
    product?._id || product?.id || product?.productId || product?.productoId || product?.producto_id

  const normalizeArea = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')

  const getProductArea = (product) =>
    product?.area ||
    product?.Area ||
    product?.departamento ||
    product?.Departamento ||
    product?.sector ||
    product?.Sector ||
    product?.categoria ||
    product?.Categoria ||
    product?.subArea ||
    product?.subarea

  const asDisplayText = (value) => {
    if (value === null || value === undefined) return null
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim()
      return text || null
    }
    return null
  }

  const unwrapTypedValue = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value

    if (typeof value.stringValue === 'string') return value.stringValue
    if (typeof value.integerValue === 'string' || typeof value.integerValue === 'number') return value.integerValue
    if (typeof value.doubleValue === 'number' || typeof value.doubleValue === 'string') return value.doubleValue
    if (typeof value.booleanValue === 'boolean') return value.booleanValue
    if (value.timestampValue) return value.timestampValue

    if (value.mapValue?.fields && typeof value.mapValue.fields === 'object') {
      const out = {}
      Object.entries(value.mapValue.fields).forEach(([k, v]) => {
        out[k] = unwrapTypedValue(v)
      })
      return out
    }

    if (Array.isArray(value.arrayValue?.values)) {
      return value.arrayValue.values.map((v) => unwrapTypedValue(v))
    }

    if (value.fields && typeof value.fields === 'object') {
      const out = {}
      Object.entries(value.fields).forEach(([k, v]) => {
        out[k] = unwrapTypedValue(v)
      })
      return out
    }

    return value
  }

  const deepFindScalar = (obj, matcher, depth = 0, maxDepth = 4) => {
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

  const getProductName = (product) => {
    const directCandidates = [
      product?.nombre,
      product?.Nombre,
      product?.name,
      product?.Name,
      product?.Producto,
      product?.producto,
      product?.Dispositivo,
      product?.dispositivo,
      product?.productoNombre,
      product?.producto_nombre,
      product?.nombreProducto,
      product?.productName,
      product?.nombre_producto,
      product?.itemName,
      product?.descripcionProducto,
      product?.descripcion,
      product?.description,
      product?.titulo,
      product?.title,
    ]

    for (const value of directCandidates) {
      const text = asDisplayText(unwrapTypedValue(value))
      if (text) return text
    }

    const nestedCandidates = [
      product?.producto?.nombre,
      product?.producto?.name,
      product?.item?.nombre,
      product?.item?.name,
    ]

    for (const value of nestedCandidates) {
      const text = asDisplayText(unwrapTypedValue(value))
      if (text) return text
    }

    const deepName = deepFindScalar(product, (key) => {
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
    const deepNameText = asDisplayText(deepName)
    if (deepNameText) return deepNameText

    return asDisplayText(getProductId(product)) || 'Sin nombre'
  }

  const getProductStock = (product) => {
    const rawStock =
      product?.stock ??
      product?.Stock ??
      product?.cantidad ??
      product?.cantidadDisponible ??
      product?.stockDisponible ??
      product?.stockActual ??
      product?.stock_actual ??
      product?.cantidadActual ??
      product?.cantidad_actual ??
      product?.existencia ??
      product?.existencias ??
      product?.disponible ??
      product?.disponibles ??
      product?.availableStock ??
      product?.quantity ??
      product?.qty ??
      product?.inventario?.stock ??
      product?.inventario?.cantidad

    const deepStock =
      rawStock ??
      deepFindScalar(product, (key) => {
        const normalized = String(key).toLowerCase()
        return (
          normalized.includes('stock') ||
          normalized.includes('existencia') ||
          normalized.includes('cantidad') ||
          normalized.includes('disponible') ||
          normalized.includes('inventario') ||
          normalized.includes('available')
        )
      })

    const normalizedStock = unwrapTypedValue(deepStock)
    if (normalizedStock === null || normalizedStock === undefined || normalizedStock === '') return '—'

    const numeric = Number(normalizedStock)
    if (Number.isNaN(numeric)) return String(normalizedStock)

    return Number.isInteger(numeric) ? numeric : numeric.toFixed(2)
  }

  useEffect(() => {
    if (!firebaseToken) return

    setLoading(true)
    setError(null)

    const url = `${apiBase}/inventory/products?area=${encodeURIComponent(area)}`
    let active = true

    const loadProducts = async () => {
      try {
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${firebaseToken}`,
            'Content-Type': 'application/json',
          },
        })
        const data = await response.json()

        // Inventory API may return multiple shapes: array, {data:[...]}, {products:[...]}, {data:{products:[...]}}
        const rawList =
          Array.isArray(data)
            ? data
            : Array.isArray(data?.data)
              ? data.data
              : Array.isArray(data?.products)
                ? data.products
                : Array.isArray(data?.data?.products)
                  ? data.data.products
                  : Array.isArray(data?.items)
                    ? data.items
                    : []

        const flattened = rawList.map((item) => {
          // Firestore REST-style shape: { name, fields: { nombre: {stringValue: ...} } }
          if (item && typeof item === 'object' && item.fields && typeof item.fields === 'object') {
            const decodedFields = unwrapTypedValue({ fields: item.fields }) || {}
            const fallbackId = typeof item.name === 'string' ? item.name.split('/').pop() : undefined
            return {
              id: item.id || item._id || fallbackId,
              ...decodedFields,
            }
          }

          // Flatten common wrapper shape: { id, data: {...} }
          if (item && typeof item === 'object' && item.data && typeof item.data === 'object' && !Array.isArray(item.data)) {
            return {
              id: item.id || item._id || item.data.id,
              ...item.data,
            }
          }
          return item
        })

        const selectedArea = normalizeArea(area)
        const filteredByArea = flattened.filter((item) => {
          const itemArea = normalizeArea(getProductArea(item))
          return itemArea === selectedArea
        })

        if (active) setProducts(filteredByArea)
      } catch (err) {
        if (active) setError(err.message)
      } finally {
        if (active) setLoading(false)
      }
    }

    loadProducts()

    return () => {
      active = false
    }
  }, [area, apiBase, firebaseToken])

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

  const isSelected = (product) => {
    const id = getProductId(product)
    return !!selectedItems.find((i) => i.productId === id)
  }

  const getQty = (product) => {
    const id = getProductId(product)
    return selectedItems.find((i) => i.productId === id)?.qty ?? 1
  }

  if (loading) {
    return (
      <div className="wizard-step">
        <h2 className="step-title"><span className="step-num">2</span> Selecciona productos</h2>
        <div className="loading-state">
          <div className="spinner" />
          <p>Cargando productos de <strong>{area}</strong>...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="wizard-step">
        <h2 className="step-title"><span className="step-num">2</span> Selecciona productos</h2>
        <div className="error-state">
          <p>Error al cargar productos: {error}</p>
          <button className="btn-secondary" onClick={onBack}>← Volver</button>
        </div>
      </div>
    )
  }

  return (
    <div className="wizard-step">
      <h2 className="step-title">
        <span className="step-num">2</span> Selecciona productos
        <span className="step-subtitle"> — {area}</span>
      </h2>

      {products.length === 0 ? (
        <div className="empty-state">
          <p>No se encontraron productos para el área <strong>{area}</strong>.</p>
        </div>
      ) : (
        <div className="products-table-wrap">
          <table className="products-table">
            <thead>
              <tr>
                <th></th>
                <th>Producto</th>
                <th>Stock disponible</th>
                <th>Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const id = getProductId(p)
                const selected = isSelected(p)
                return (
                  <tr key={id} className={selected ? 'row-selected' : ''} onClick={() => toggleItem(p)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleItem(p)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>
                      <strong>{getProductName(p)}</strong>
                      {p.sku && <span className="sku"> ({p.sku})</span>}
                    </td>
                    <td>{getProductStock(p)}</td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        value={getQty(p)}
                        disabled={!selected}
                        className="qty-input"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setQty(id, e.target.value)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedItems.length > 0 && (
        <p className="selection-summary">{selectedItems.length} producto(s) seleccionado(s)</p>
      )}

      <div className="step-footer">
        <button className="btn-secondary" onClick={onBack}>← Volver</button>
        <button
          className="btn-primary"
          disabled={selectedItems.length === 0}
          onClick={onNext}
        >
          Siguiente →
        </button>
      </div>
    </div>
  )
}
