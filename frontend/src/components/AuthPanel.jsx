import React from 'react'

export default function AuthPanel({
  userId,
  setUserId,
  userRole,
  setUserRole,
  authToken,
  setAuthToken,
  apiBase,
  setApiBase,
}) {
  return (
    <section className="panel auth-panel">
      <h2>Contexto</h2>
      <div className="grid two">
        <label>
          Usuario (x-user-id)
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </label>
        <label>
          Rol (x-user-role)
          <select value={userRole} onChange={(e) => setUserRole(e.target.value)}>
            <option value="user">user</option>
            <option value="supervisor">supervisor</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label className="full">
          Bearer token (opcional)
          <input
            type="text"
            placeholder="eyJhbGciOi..."
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
          />
        </label>
        <label className="full">
          API Base URL
          <input
            type="text"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
          />
        </label>
      </div>
    </section>
  )
}
