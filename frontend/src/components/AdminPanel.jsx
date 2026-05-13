import React, { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'

// ── Helpers ───────────────────────────────────────────────────────────────────
const ROLES = ['usuario', 'jefe_area', 'admin', 'superadmin']
const ROLE_LABEL = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  jefe_area: 'Jefe de Área',
  usuario: 'Usuario',
}
const STATUS_LABEL = {
  CREADO: 'Creado',
  EN_REVISION: 'En revisión',
  RECHAZADO: 'Rechazado',
  STOCK_ACTUALIZADO: 'Stock actualizado',
  NOTIFICADO: 'Notificado',
}
const STATUS_COLOR = {
  CREADO: 'var(--text-muted)',
  EN_REVISION: '#b07d00',
  RECHAZADO: '#c0392b',
  STOCK_ACTUALIZADO: '#2d6e62',
  NOTIFICADO: '#2d6e62',
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
}

// ── Skeleton loader ───────────────────────────────────────────────────────────
function SkeletonTable({ cols = 5, rows = 5 }) {
  return (
    <div className="admin-table-wrap" style={{ padding: '4px 0' }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-row" style={{ padding: '12px 20px' }}>
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="skeleton skeleton-text"
              style={{ flex: c === 0 ? '0 0 80px' : 1, height: 14 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Tab: Tickets ──────────────────────────────────────────────────────────────
const TICKETS_PAGE_SIZE = 10

function TicketsTab({ apiBase, firebaseToken }) {
  const toast = useToast()
  const [tickets, setTickets] = useState([])
  const [filterStatus, setFilterStatus] = useState('EN_REVISION')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [actionState, setActionState] = useState({}) // { [ticketId]: 'loading'|'done'|'error' }
  const [rejectModal, setRejectModal] = useState(null) // { ticketId }
  const [rejectComment, setRejectComment] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [page, setPage] = useState(1)
  const [downloading, setDownloading] = useState(null)

  const downloadTicket = async (ticketId, format, e) => {
    e.stopPropagation()
    const key = `${ticketId}-${format}`
    setDownloading(key)
    try {
      const res = await fetch(`${apiBase}/tickets/${ticketId}/download?format=${format}`, {
        headers: { Authorization: `Bearer ${firebaseToken}` },
      })
      if (!res.ok) { toast.error('Error al generar el documento.'); return }
      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = format === 'word' ? `ticket-${ticketId}.docx` : `ticket-${ticketId}.pdf`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch {
      toast.error('Error al descargar el documento.')
    } finally {
      setDownloading(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = filterStatus ? `?status=${filterStatus}` : ''
      const res = await fetch(`${apiBase}/admin/tickets${qs}`, {
        headers: { Authorization: `Bearer ${firebaseToken}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setTickets(data.tickets || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiBase, firebaseToken, filterStatus])

  useEffect(() => { load() }, [load])
  // Reset page when filter changes
  useEffect(() => { setPage(1) }, [filterStatus])

  const approve = async (ticketId) => {
    setActionState((s) => ({ ...s, [ticketId]: 'loading' }))
    try {
      const res = await fetch(`${apiBase}/admin/tickets/${ticketId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${firebaseToken}`, 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setActionState((s) => ({ ...s, [ticketId]: 'done' }))
      setTickets((ts) => ts.filter((t) => t.id !== ticketId))
      toast.success('Ticket aprobado correctamente.')
    } catch (e) {
      setActionState((s) => ({ ...s, [ticketId]: 'error:' + e.message }))
      toast.error('Error al aprobar: ' + e.message)
    }
  }

  const reject = async () => {
    if (!rejectModal) return
    const { ticketId } = rejectModal
    setActionState((s) => ({ ...s, [ticketId]: 'loading' }))
    try {
      const res = await fetch(`${apiBase}/admin/tickets/${ticketId}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${firebaseToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: rejectComment }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setActionState((s) => ({ ...s, [ticketId]: 'done' }))
      setTickets((ts) => ts.filter((t) => t.id !== ticketId))
      setRejectModal(null)
      setRejectComment('')
      toast.info('Ticket rechazado.')
    } catch (e) {
      setActionState((s) => ({ ...s, [ticketId]: 'error:' + e.message }))
      setRejectModal(null)
      toast.error('Error al rechazar: ' + e.message)
    }
  }

  return (
    <div className="admin-tab">
      <div className="admin-toolbar">
        <h3 className="admin-tab-title">Aprobación de Tickets</h3>
        <div className="admin-toolbar-right">
          <select
            className="admin-select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="EN_REVISION">En revisión</option>
            <option value="CREADO">Creados</option>
            <option value="RECHAZADO">Rechazados</option>
            <option value="NOTIFICADO">Notificados</option>
            <option value="STOCK_ACTUALIZADO">Stock actualizado</option>
          </select>
          <button className="btn-admin-secondary" onClick={load} disabled={loading}>
            {loading ? '…' : '↺ Actualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="admin-error">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonTable cols={7} rows={5} />
      ) : tickets.length === 0 ? (
        <div className="admin-empty">
          <div className="empty-state-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <strong>{filterStatus === 'EN_REVISION' ? 'Sin tickets pendientes' : 'Sin tickets'}</strong>
          <p>{filterStatus === 'EN_REVISION' ? 'No hay tickets pendientes de aprobación.' : 'No hay tickets con ese estado.'}</p>
        </div>
      ) : (
        <>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Área</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Solicitado por</th>
                <th>Fecha</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tickets.slice((page - 1) * TICKETS_PAGE_SIZE, page * TICKETS_PAGE_SIZE).map((t) => {
                const state = actionState[t.id] || ''
                const isLoading = state === 'loading'
                const isError = state.startsWith('error:')
                return (
                  <React.Fragment key={t.id}>
                    <tr
                      className={`admin-row ${expandedId === t.id ? 'expanded' : ''}`}
                      onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    >
                      <td className="ticket-id">{t.id.slice(0, 8)}…</td>
                      <td>{t.metadata?.area || '—'}</td>
                      <td>
                        <span className={`badge badge-${t.type?.toLowerCase()}`}>
                          {t.type === 'EXIT' ? 'Salida' : 'Entrada'}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill status-${t.status}`}>
                          {STATUS_LABEL[t.status] || t.status}
                        </span>
                      </td>
                      <td className="ticket-user">{t.requestedBy?.slice(0, 12) || '—'}</td>
                      <td>{formatDate(t.createdAt)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {t.status === 'EN_REVISION' && (
                          <div className="action-btns">
                            <button
                              className="btn-approve"
                              disabled={isLoading}
                              onClick={() => approve(t.id)}
                            >
                              {isLoading ? '…' : '✓ Aprobar'}
                            </button>
                            <button
                              className="btn-reject"
                              disabled={isLoading}
                              onClick={() => { setRejectModal({ ticketId: t.id }); setRejectComment('') }}
                            >
                              ✕ Rechazar
                            </button>
                          </div>
                        )}
                        {isError && <span className="admin-inline-error">{state.replace('error:', '')}</span>}
                      </td>
                    </tr>
                    {expandedId === t.id && (
                      <tr className="admin-detail-row">
                        <td colSpan={7}>
                          <div className="admin-detail">
                            <div className="admin-detail-section">
                              <strong>ID completo</strong>
                              <span style={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>{t.id}</span>
                            </div>
                            <div className="admin-detail-section">
                              <strong>Motivo</strong>
                              <span>{t.metadata?.motivo || '—'}</span>
                            </div>
                            <div className="admin-detail-section">
                              <strong>Destino</strong>
                              <span>{t.metadata?.destino || '—'}</span>
                            </div>
                            <div className="admin-detail-section">
                              <strong>Firma</strong>
                              <span>{t.metadata?.firma || '—'}</span>
                            </div>
                            {t.reviewComment && (
                              <div className="admin-detail-section">
                                <strong>Rechazo</strong>
                                <span style={{ color: 'var(--red)' }}>{t.reviewComment}</span>
                              </div>
                            )}
                            <div className="admin-detail-section admin-detail-full">
                              <strong>Productos ({t.items?.length || 0})</strong>
                              <ul className="admin-items-list">
                                {(t.items || []).map((item, i) => (
                                  <li key={i}>
                                    {item.nombre || item.name || item.productId || item.id}
                                    {item.qty ? ` ×${item.qty}` : ''}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className="admin-detail-section admin-detail-full" style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', marginTop: '4px' }}>
                              <strong>Descargar ticket</strong>
                              <div className="action-btns" style={{ marginTop: '6px' }}>
                                <button
                                  className="btn-download-sm pdf"
                                  disabled={downloading === `${t.id}-pdf`}
                                  onClick={(e) => downloadTicket(t.id, 'pdf', e)}
                                >
                                  {downloading === `${t.id}-pdf`
                                    ? <span className="spinner spinner-sm" style={{ borderTopColor: 'rgba(255,255,255,0.9)', width: 12, height: 12 }} />
                                    : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><polyline points="9 15 12 18 15 15"/></svg>}
                                  PDF
                                </button>
                                <button
                                  className="btn-download-sm word"
                                  disabled={downloading === `${t.id}-word`}
                                  onClick={(e) => downloadTicket(t.id, 'word', e)}
                                >
                                  {downloading === `${t.id}-word`
                                    ? <span className="spinner spinner-sm" style={{ borderTopColor: 'rgba(255,255,255,0.9)', width: 12, height: 12 }} />
                                    : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>}
                                  Word
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(tickets.length / TICKETS_PAGE_SIZE))}
          totalItems={tickets.length}
          onPrev={() => setPage((p) => p - 1)}
          onNext={() => setPage((p) => p + 1)}
        />
        </>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="modal-overlay" onClick={() => setRejectModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h4>Rechazar ticket</h4>
                <p className="modal-sub">Ticket: {rejectModal.ticketId.slice(0, 12)}…</p>
              </div>
              <button className="modal-close-btn" onClick={() => setRejectModal(null)} aria-label="Cerrar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <label className="admin-label">Motivo del rechazo (opcional)</label>
            <textarea
              className="admin-textarea"
              rows={3}
              placeholder="Escribe el motivo del rechazo…"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-admin-secondary" onClick={() => setRejectModal(null)}>Cancelar</button>
              <button className="btn-reject" onClick={reject}>Confirmar rechazo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Usuarios ─────────────────────────────────────────────────────────────
const USERS_PAGE_SIZE = 15

function UsersTab({ apiBase, firebaseToken, currentUserEmail }) {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [form, setForm] = useState({ email: '', nombre: '', rol: 'usuario', areasPermitidas: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/admin/users`, {
        headers: { Authorization: `Bearer ${firebaseToken}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setUsers(data.users || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiBase, firebaseToken])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditUser(null)
    setForm({ email: '', nombre: '', rol: 'usuario', areasPermitidas: '' })
    setSaveError(null)
    setShowForm(true)
  }

  const openEdit = (u) => {
    setEditUser(u)
    setForm({
      email: u.email,
      nombre: u.nombre || '',
      rol: u.rol || 'usuario',
      areasPermitidas: Array.isArray(u.areasPermitidas) ? u.areasPermitidas.join(', ') : '',
    })
    setSaveError(null)
    setShowForm(true)
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const areasArray = form.areasPermitidas
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      let res
      if (editUser) {
        res = await fetch(`${apiBase}/admin/users/${editUser.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${firebaseToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: form.nombre, rol: form.rol, areasPermitidas: areasArray }),
        })
      } else {
        res = await fetch(`${apiBase}/admin/users`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${firebaseToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: form.email, nombre: form.nombre, rol: form.rol, areasPermitidas: areasArray }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setShowForm(false)
      toast.success(editUser ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.')
      load()
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteU = async (uid, email) => {
    if (!window.confirm(`¿Eliminar usuario ${email}?`)) return
    try {
      const res = await fetch(`${apiBase}/admin/users/${uid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${firebaseToken}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      toast.success(`Usuario ${email} eliminado.`)
      load()
    } catch (e) {
      toast.error('Error al eliminar: ' + e.message)
    }
  }

  return (
    <div className="admin-tab">
      <div className="admin-toolbar">
        <h3 className="admin-tab-title">Gestión de Usuarios</h3>
        <div className="admin-toolbar-right">
          <button className="btn-admin-primary" onClick={openCreate}>+ Nuevo usuario</button>
          <button className="btn-admin-secondary" onClick={load} disabled={loading}>↺</button>
        </div>
      </div>

      {error && (
        <div className="admin-error">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonTable cols={5} rows={6} />
      ) : users.length === 0 ? (
        <div className="admin-empty">
          <div className="empty-state-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
          </div>
          <strong>Sin usuarios registrados</strong>
          <p>Crea el primer usuario con el botón de arriba.</p>
        </div>
      ) : (
        <>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Áreas permitidas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.slice((page - 1) * USERS_PAGE_SIZE, page * USERS_PAGE_SIZE).map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    {u.email === currentUserEmail && <span className="badge-you"> (tú)</span>}
                  </td>
                  <td>{u.nombre || '—'}</td>
                  <td>
                    <span className={`role-badge role-${u.rol}`}>
                      {ROLE_LABEL[u.rol] || u.rol}
                    </span>
                  </td>
                  <td className="areas-cell">
                    {Array.isArray(u.areasPermitidas) && u.areasPermitidas.length > 0
                      ? u.areasPermitidas.join(', ')
                      : <span style={{ color: 'var(--text-muted)' }}>Todas</span>}
                  </td>
                  <td>
                    <div className="action-btns">
                      <button className="btn-admin-secondary btn-sm" onClick={() => openEdit(u)}>Editar</button>
                      {u.email !== currentUserEmail && (
                        <button className="btn-danger btn-sm" onClick={() => deleteU(u.id, u.email)}>Eliminar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(users.length / USERS_PAGE_SIZE))}
          totalItems={users.length}
          onPrev={() => setPage((p) => p - 1)}
          onNext={() => setPage((p) => p + 1)}
        />
        </>
      )}

      {/* Create/Edit modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h4>{editUser ? 'Editar usuario' : 'Nuevo usuario'}</h4>
              <button className="modal-close-btn" onClick={() => setShowForm(false)} aria-label="Cerrar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {!editUser && (
              <div className="form-group">
                <label className="admin-label">Email *</label>
                <input
                  className="admin-input"
                  type="email"
                  placeholder="usuario@ejemplo.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
            )}

            <div className="form-group">
              <label className="admin-label">Nombre</label>
              <input
                className="admin-input"
                type="text"
                placeholder="Nombre completo"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="admin-label">Rol</label>
              <select
                className="admin-select"
                value={form.rol}
                onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value }))}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="admin-label">
                Áreas permitidas
                <span className="label-hint"> (separadas por coma — vacío = todas)</span>
              </label>
              <input
                className="admin-input"
                type="text"
                placeholder="Compras, Sistemas, Almacén"
                value={form.areasPermitidas}
                onChange={(e) => setForm((f) => ({ ...f, areasPermitidas: e.target.value }))}
              />
            </div>

            {saveError && <p className="admin-error">{saveError}</p>}

            <div className="modal-actions">
              <button className="btn-admin-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button className="btn-admin-primary" onClick={save} disabled={saving}>
                {saving ? 'Guardando…' : editUser ? 'Guardar cambios' : 'Crear usuario'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Configuración de correos ─────────────────────────────────────────────
function EmailConfigTab({ apiBase, firebaseToken }) {
  const toast = useToast()
  const [config, setConfig] = useState({ recipients: [], ccRecipients: [], fromName: 'Cielito Home' })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [newEmail, setNewEmail] = useState('')
  const [newCc, setNewCc] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`${apiBase}/admin/email-config`, {
      headers: { Authorization: `Bearer ${firebaseToken}` },
    })
      .then((r) => r.json())
      .then((data) => { if (!data.error) setConfig(data) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [apiBase, firebaseToken])

  const addEmail = (field, value, setter) => {
    const trimmed = value.trim()
    if (!trimmed || !trimmed.includes('@')) return
    setConfig((c) => ({ ...c, [field]: [...(c[field] || []), trimmed] }))
    setter('')
  }

  const removeEmail = (field, idx) => {
    setConfig((c) => ({ ...c, [field]: c[field].filter((_, i) => i !== idx) }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/admin/email-config`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${firebaseToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      toast.success('Configuración de correos guardada correctamente.')
    } catch (e) {
      setError(e.message)
      toast.error('Error al guardar: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="admin-tab">
      <div className="admin-toolbar"><h3 className="admin-tab-title">Configuración de Correos</h3></div>
      <div className="admin-loading"><div className="spinner spinner-sm" /><span>Cargando configuración…</span></div>
    </div>
  )

  return (
    <div className="admin-tab">
      <div className="admin-toolbar">
        <h3 className="admin-tab-title">Configuración de Correos</h3>
      </div>

      {error && (
        <div className="admin-error">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {error}
        </div>
      )}

      <div className="email-config-form">
        <div className="form-group">
          <label className="admin-label">Nombre del remitente</label>
          <input
            className="admin-input"
            style={{ maxWidth: '340px' }}
            value={config.fromName}
            onChange={(e) => setConfig((c) => ({ ...c, fromName: e.target.value }))}
          />
        </div>

        <div className="form-group">
          <label className="admin-label">
            Destinatarios principales
            <span className="label-hint"> (recibirán todos los correos de tickets)</span>
          </label>
          <div className="email-tags">
            {(config.recipients || []).map((e, i) => (
              <span key={i} className="email-tag">
                {e}
                <button className="tag-remove" onClick={() => removeEmail('recipients', i)}>×</button>
              </span>
            ))}
          </div>
          <div className="email-add-row">
            <input
              className="admin-input"
              type="email"
              placeholder="correo@ejemplo.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addEmail('recipients', newEmail, setNewEmail)}
            />
            <button className="btn-admin-secondary btn-sm" onClick={() => addEmail('recipients', newEmail, setNewEmail)}>
              Agregar
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="admin-label">
            Destinatarios en copia (CC)
            <span className="label-hint"> (opcional)</span>
          </label>
          <div className="email-tags">
            {(config.ccRecipients || []).map((e, i) => (
              <span key={i} className="email-tag email-tag-cc">
                {e}
                <button className="tag-remove" onClick={() => removeEmail('ccRecipients', i)}>×</button>
              </span>
            ))}
          </div>
          <div className="email-add-row">
            <input
              className="admin-input"
              type="email"
              placeholder="copia@ejemplo.com"
              value={newCc}
              onChange={(e) => setNewCc(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addEmail('ccRecipients', newCc, setNewCc)}
            />
            <button className="btn-admin-secondary btn-sm" onClick={() => addEmail('ccRecipients', newCc, setNewCc)}>
              Agregar
            </button>
          </div>
        </div>

        <button className="btn-admin-primary" onClick={save} disabled={saving} style={{ marginTop: '8px' }}>
          {saving ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  )
}

// ── Hash helpers for tab navigation ────────────────────────────────────────────
const TAB_IDS = ['tickets', 'users', 'emails']

function getTabFromHash() {
  const parts = window.location.hash.slice(1).split('/')
  const tab = parts[1]
  return TAB_IDS.includes(tab) ? tab : 'tickets'
}

// ── Pagination component ───────────────────────────────────────────────────
function Pagination({ page, totalPages, onPrev, onNext, totalItems }) {
  if (totalPages <= 1) return null
  return (
    <div className="pagination">
      <button className="btn-admin-secondary btn-sm" onClick={onPrev} disabled={page === 1}>← Anterior</button>
      <span className="pagination-info">Página {page} de {totalPages} &middot; {totalItems} registros</span>
      <button className="btn-admin-secondary btn-sm" onClick={onNext} disabled={page === totalPages}>Siguiente →</button>
    </div>
  )
}

// ── Main AdminPanel ─────────────────────────────────────────────────────
const TICKET_ICON = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
const USERS_ICON  = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/></svg>
const MAIL_ICON   = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>

const TABS = [
  { id: 'tickets', label: 'Tickets', icon: TICKET_ICON },
  { id: 'users',   label: 'Usuarios', icon: USERS_ICON },
  { id: 'emails',  label: 'Correos',  icon: MAIL_ICON },
]

export default function AdminPanel({ apiBase, firebaseToken, currentUserEmail, onBack }) {
  const [activeTab, setActiveTab] = useState(getTabFromHash)

  useEffect(() => {
    const handleHashChange = () => setActiveTab(getTabFromHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const switchTab = (id) => {
    window.location.hash = `admin/${id}`
    setActiveTab(id)
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-header">
        <div className="admin-header-left">
          <button className="btn-back" onClick={onBack}>← Volver</button>
          <h2 className="admin-panel-title">Panel de Administración</h2>
        </div>
        <span className="admin-user-badge">{currentUserEmail}</span>
      </div>

      <nav className="admin-tabs-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`admin-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => switchTab(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className="admin-tab-content">
        {activeTab === 'tickets' && (
          <TicketsTab apiBase={apiBase} firebaseToken={firebaseToken} />
        )}
        {activeTab === 'users' && (
          <UsersTab apiBase={apiBase} firebaseToken={firebaseToken} currentUserEmail={currentUserEmail} />
        )}
        {activeTab === 'emails' && (
          <EmailConfigTab apiBase={apiBase} firebaseToken={firebaseToken} />
        )}
      </div>
    </div>
  )
}
