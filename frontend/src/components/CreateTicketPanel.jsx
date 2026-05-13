import React, { useState } from 'react'

export default function CreateTicketPanel({ callApi, setTicketId }) {
  const [type, setType] = useState('EXIT')
  const [assignedUsers, setAssignedUsers] = useState('compras@empresa.com,almacen@empresa.com')
  const [items, setItems] = useState(
    JSON.stringify([
      { productId: 'prod_001', qty: 1, area: 'Almacen' },
      { productId: 'prod_002', qty: 2, area: 'Almacen' },
    ], null, 2)
  )
  const [metadata, setMetadata] = useState(JSON.stringify({ motivo: 'Prueba desde React' }, null, 2))

  const handleCreate = async () => {
    try {
      const users = assignedUsers
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)

      const parsedItems = items.trim() ? JSON.parse(items) : []
      const parsedMetadata = metadata.trim() ? JSON.parse(metadata) : {}

      const result = await callApi(
        'Crear ticket',
        '/tickets',
        'POST',
        {
          type,
          items: parsedItems,
          assignedUsers: users,
          metadata: parsedMetadata,
        }
      )

      if (result?.ticketId) {
        setTicketId(result.ticketId)
      }
    } catch (error) {
      console.error('Error validando', error)
    }
  }

  return (
    <section className="panel">
      <h2>Crear ticket</h2>
      <div className="grid two">
        <label>
          Tipo
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="EXIT">EXIT</option>
            <option value="ENTRY">ENTRY</option>
          </select>
        </label>
        <label>
          Usuarios asignados (coma)
          <input
            type="text"
            value={assignedUsers}
            onChange={(e) => setAssignedUsers(e.target.value)}
          />
        </label>
        <label className="full">
          Items (JSON)
          <textarea
            rows="5"
            value={items}
            onChange={(e) => setItems(e.target.value)}
          />
        </label>
        <label className="full">
          Metadata (JSON opcional)
          <textarea
            rows="4"
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
          />
        </label>
      </div>
      <button className="primary" onClick={handleCreate}>
        Crear ticket
      </button>
    </section>
  )
}
