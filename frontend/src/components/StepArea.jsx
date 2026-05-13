import React, { useEffect, useState } from 'react'

export default function StepArea({
  area,
  setArea,
  ticketType,
  setTicketType,
  userId,
  setUserId,
  userRole,
  setUserRole,
  apiBase,
  firebaseToken,
  onNext,
}) {
  const [areas, setAreas] = useState([])
  const [loadingAreas, setLoadingAreas] = useState(true)
  const [areasError, setAreasError] = useState('')

  useEffect(() => {
    if (!firebaseToken) return

    setLoadingAreas(true)
    setAreasError('')

    const tokenFingerprint = String(firebaseToken).slice(0, 24)
    const cacheKey = `areas:${apiBase}:${tokenFingerprint}`
    const cacheTtlMs = 60 * 1000
    const cachedRaw = sessionStorage.getItem(cacheKey)
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw)
        if (Date.now() - Number(cached?.savedAt || 0) < cacheTtlMs && Array.isArray(cached?.areas)) {
          setAreas(cached.areas)
          setLoadingAreas(false)
          return
        }
      } catch {
        // ignore cache parse errors
      }
    }

    let active = true

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    const fetchAreasWithRetry = async () => {
      const maxAttempts = 3

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await fetch(`${apiBase}/inventory/areas`, {
          headers: {
            'Authorization': `Bearer ${firebaseToken}`,
          },
        })

        const data = await response.json().catch(() => ({}))

        if (response.ok) {
          return data
        }

        const message = data?.error || `Error ${response.status} cargando areas`
        const isRateLimited = response.status === 429 || /demasiadas solicitudes|too many requests/i.test(message)

        if (!isRateLimited || attempt === maxAttempts) {
          throw new Error(message)
        }

        // Backoff corto para no saturar la API externa.
        await wait(500 * attempt)
      }

      return { areas: [] }
    }

    fetchAreasWithRetry()
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.areas) ? data.areas : []
        setAreas(list)
        sessionStorage.setItem(cacheKey, JSON.stringify({ areas: list, savedAt: Date.now() }))
      })
      .catch((err) => {
        if (!active) return
        setAreasError(err.message)
      })
      .finally(() => {
        if (!active) return
        setLoadingAreas(false)
      })

    return () => {
      active = false
    }
  }, [apiBase, firebaseToken])

  useEffect(() => {
    if (!area && areas.length > 0) {
      setArea(areas[0])
    }
  }, [areas, area, setArea])

  const valid = area.trim() && userId.trim()

  return (
    <div className="wizard-step">
      <h2 className="step-title"><span className="step-num">1</span> Selecciona área y tipo</h2>

      <div className="field-group">
        <label>
          Área <span className="required">*</span>
          {loadingAreas && <p className="helper-msg">Cargando áreas desde la API...</p>}
          {!loadingAreas && areasError && (
            <>
              <p className="error-msg">No se pudieron cargar áreas desde la API: {areasError}</p>
              <p className="helper-msg">Escribe el área manualmente tal como existe en tu API.</p>
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="ej. compras"
              />
            </>
          )}
          {!loadingAreas && !areasError && areas.length === 0 && (
            <>
              <p className="helper-msg">No hay áreas disponibles en la API. Escribe un área manualmente.</p>
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="ej. compras"
              />
            </>
          )}
          {areas.length > 0 && (
            <div className="area-grid">
              {areas.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`area-btn ${area === a ? 'active' : ''}`}
                  onClick={() => setArea(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </label>
      </div>

      <div className="field-group">
        <label>Tipo de movimiento <span className="required">*</span></label>
        <div className="type-toggle">
          <button
            type="button"
            className={`toggle-btn ${ticketType === 'EXIT' ? 'active exit' : ''}`}
            onClick={() => setTicketType('EXIT')}
          >
            Salida
          </button>
          <button
            type="button"
            className={`toggle-btn ${ticketType === 'ENTRY' ? 'active entry' : ''}`}
            onClick={() => setTicketType('ENTRY')}
          >
            Entrada
          </button>
        </div>
      </div>

      <div className="field-row">
        <label>
          Usuario (ID) <span className="required">*</span>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="ej. juan.perez"
          />
        </label>
        <label>
          Rol
          <select value={userRole} onChange={(e) => setUserRole(e.target.value)}>
            <option value="user">Usuario</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>

      <div className="step-footer">
        <button className="btn-primary" disabled={!valid || loadingAreas} onClick={onNext}>
          Siguiente →
        </button>
      </div>
    </div>
  )
}
