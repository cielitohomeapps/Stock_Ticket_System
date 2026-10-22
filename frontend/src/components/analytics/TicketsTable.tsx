/**
 * Tabla paginada y ordenable de solicitudes con exportación
 */

import React, { useState, useMemo } from 'react';
import type { TicketTableRow, TicketStatus } from '../../types/analytics.types';
import '../styles/analytics.css';

interface TicketsTableProps {
  data: TicketTableRow[];
  onExport: (visibleRows: TicketTableRow[]) => void;
}

type SortField = 'createdDate' | 'type' | 'status' | 'approvalTimeHours';
type SortOrder = 'asc' | 'desc';

/**
 * Tickets Table Component
 * Displays paginated, sortable tickets with filtering and CSV export
 */
export const TicketsTable: React.FC<TicketsTableProps> = ({ data, onExport }) => {
  const ROWS_PER_PAGE = 20;

  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('createdDate');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('ALL');

  // Filter by status
  const filteredData = useMemo(() => {
    if (statusFilter === 'ALL') return data;
    return data.filter((ticket) => ticket.status === statusFilter);
  }, [data, statusFilter]);

  // Sort data
  const sortedData = useMemo(() => {
    const sorted = [...filteredData];
    sorted.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Handle undefined values
      if (aVal === undefined) aVal = 0;
      if (bVal === undefined) bVal = 0;

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredData, sortField, sortOrder]);

  // Paginate
  const totalPages = Math.ceil(sortedData.length / ROWS_PER_PAGE);
  const startIdx = (currentPage - 1) * ROWS_PER_PAGE;
  const endIdx = startIdx + ROWS_PER_PAGE;
  const pageData = sortedData.slice(startIdx, endIdx);

  // Handle sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  // Handle export
  const handleExport = () => {
    onExport(sortedData);
  };

  // Get sort indicator
  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return ' ⇅';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  // Get status badge class
  const getStatusBadgeClass = (status: TicketStatus) => {
    switch (status) {
      case 'APROBADO':
      case 'STOCK_ACTUALIZADO':
      case 'NOTIFICADO':
        return 'status-badge status-approved';
      case 'PENDIENTE':
      case 'ENVIADO':
      case 'EN_REVISION':
      case 'PENDIENTE_CORRECCION':
        return 'status-badge status-pending';
      case 'RECHAZADO':
        return 'status-badge status-rejected';
      default:
        return 'status-badge status-default';
    }
  };

  const getStatusLabel = (status: TicketStatus) => {
    const labels: Record<TicketStatus, string> = {
      CREADO: 'Creado',
      PENDIENTE: 'Pendiente',
      ENVIADO: 'Enviado',
      EN_REVISION: 'En revisión',
      PENDIENTE_CORRECCION: 'Pendiente de corrección',
      APROBADO: 'Aprobado',
      STOCK_ACTUALIZADO: 'Stock actualizado',
      NOTIFICADO: 'Notificado',
      RECHAZADO: 'Rechazado',
    };
    return labels[status] || status;
  };

  return (
    <div className="tickets-table-container">
      <div className="table-header">
        <h3>Solicitudes</h3>
        <div className="table-controls">
          <div className="filter-group">
            <label>Filtrar por estado:</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as TicketStatus | 'ALL');
                setCurrentPage(1);
              }}
              className="filter-select"
            >
              <option value="ALL">Todos</option>
              <option value="CREADO">Creado</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="ENVIADO">Enviado</option>
              <option value="EN_REVISION">En revisión</option>
              <option value="PENDIENTE_CORRECCION">Pendiente de corrección</option>
              <option value="APROBADO">Aprobado</option>
              <option value="STOCK_ACTUALIZADO">Stock actualizado</option>
              <option value="NOTIFICADO">Notificado</option>
              <option value="RECHAZADO">Rechazado</option>
            </select>
          </div>
          <button onClick={handleExport} className="btn btn-primary btn-sm">
            📥 Exportar CSV
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="analytics-table tickets-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('createdDate')} className="sortable">
                Fecha
                {getSortIndicator('createdDate')}
              </th>
              <th onClick={() => handleSort('type')} className="sortable">
                Tipo
                {getSortIndicator('type')}
              </th>
              <th>Productos</th>
              <th>Área</th>
              <th>Destino</th>
              <th>Firma</th>
              <th onClick={() => handleSort('status')} className="sortable">
                Estado
                {getSortIndicator('status')}
              </th>
              <th
                onClick={() => handleSort('approvalTimeHours')}
                className="sortable text-right"
              >
                Tiempo de aprobación (h)
                {getSortIndicator('approvalTimeHours')}
              </th>
            </tr>
          </thead>
          <tbody>
            {pageData.length > 0 ? (
              pageData.map((ticket) => (
                <tr key={ticket.id}>
                  <td>
                    <time dateTime={ticket.createdDate}>{ticket.createdDate}</time>
                  </td>
                  <td>
                    <span
                      className={`type-badge ${
                        ticket.type === 'EXIT' ? 'type-exit' : 'type-entry'
                      }`}
                    >
                      {ticket.type === 'EXIT' ? 'Salida' : 'Entrada'}
                    </span>
                  </td>
                  <td>
                    <span title={ticket.productsSummary} className="products-summary">
                      {ticket.productsSummary}
                    </span>
                  </td>
                  <td>{ticket.area}</td>
                  <td>{ticket.destino}</td>
                  <td>{ticket.firma}</td>
                  <td>
                    <span className={getStatusBadgeClass(ticket.status)}>
                      {getStatusLabel(ticket.status)}
                    </span>
                  </td>
                  <td className="text-right">
                    {ticket.approvalTimeHours !== undefined ? (
                      <span>{ticket.approvalTimeHours.toLocaleString('es-MX')}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center text-muted py-4">
                  No se encontraron solicitudes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="pagination-container">
        <div className="pagination-info">
          Mostrando {sortedData.length ? startIdx + 1 : 0} a {Math.min(endIdx, sortedData.length)} de{' '}
          {sortedData.length} solicitudes
        </div>
        <div className="pagination-controls">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="btn btn-sm"
          >
            ← Anterior
          </button>
          <span className="pagination-indicator">
            Página {currentPage} de {totalPages || 1}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages || totalPages === 0}
            className="btn btn-sm"
          >
            Siguiente →
          </button>
        </div>
      </div>
    </div>
  );
};

export default TicketsTable;
