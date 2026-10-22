/**
 * @fileoverview Analytics Dashboard for Ticket Management
 * Comprehensive dashboard displaying ticket metrics, trends, and detailed analytics
 */

import React, { useState, useEffect, useMemo } from 'react';
import { getAnalyticsService, initializeAnalyticsService } from '../services/ticketAnalytics.service';
import { KPICard } from '../components/analytics/KPICard';
import { DailyVolumeChart } from '../components/analytics/DailyVolumeChart';
import { AreaDistributionChart } from '../components/analytics/AreaDistributionChart';
import { TopProductsTable } from '../components/analytics/TopProductsTable';
import { MotivoBreakdownTable } from '../components/analytics/MotivoBreakdownTable';
import { TicketsTable } from '../components/analytics/TicketsTable';
import { ProductsByLocationWidget } from '../components/analytics/ProductsByLocationWidget';
import type {
  DashboardMetrics,
  DashboardFilters,
  Ticket,
  TicketTableRow,
  CSVExportRow,
  TicketType,
  TicketStatus,
} from '../types/analytics.types';
import '../components/styles/analytics.css';

/**
 * Get current month date range
 */
function getCurrentMonthDateRange() {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startDate, endDate };
}

/**
 * Format date for input fields (YYYY-MM-DD)
 */
function formatDateForInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Analytics Dashboard Component
 * Main page for ticket analytics and reporting
 */
export function AnalyticsDashboard({ apiBase, firebaseToken }: { apiBase: string; firebaseToken: string | null }) {
  // State
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketRows, setTicketRows] = useState<TicketTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filters, setFilters] = useState<DashboardFilters>({
    dateRange: getCurrentMonthDateRange(),
    type: 'ALL',
    area: 'ALL',
    status: 'ALL',
  });

  const [dateRangeStart, setDateRangeStart] = useState(
    formatDateForInput(filters.dateRange.startDate)
  );
  const [dateRangeEnd, setDateRangeEnd] = useState(
    formatDateForInput(filters.dateRange.endDate)
  );

  // Re-initialize service when token or API base changes
  useEffect(() => {
    initializeAnalyticsService(apiBase, firebaseToken);
  }, [apiBase, firebaseToken]);

  // Fetch data when filters or token change
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const service = getAnalyticsService();

        const fetchedTickets = await service.fetchTickets(filters);
        const computedMetrics = await service.computeMetrics(filters, fetchedTickets);

        setMetrics(computedMetrics);
        setTickets(fetchedTickets);

        const rows = service.formatTicketsForTable(fetchedTickets);
        setTicketRows(rows);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : 'No se pudieron cargar los datos.';
        setError(message);
        console.error('Dashboard error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filters, firebaseToken]);

  // Handle date range changes
  const handleDateRangeChange = () => {
    const newStartDate = new Date(dateRangeStart + 'T00:00:00');
    const newEndDate = new Date(dateRangeEnd + 'T23:59:59');

    if (Number.isNaN(newStartDate.getTime()) || Number.isNaN(newEndDate.getTime()) || newStartDate > newEndDate) {
      setError('Verifica que las fechas sean válidas y que la fecha inicial no sea posterior a la final.');
      return;
    }

    setFilters({
      ...filters,
      dateRange: {
        startDate: newStartDate,
        endDate: newEndDate,
      },
    });
  };

  // Handle CSV export
  const handleExportCSV = (visibleRows: TicketTableRow[]) => {
    try {
      const service = getAnalyticsService();

      // Create map of tickets for lookup
      const ticketMap = new Map(tickets.map((t) => [t.id, t]));

      // Format rows for CSV
      const csvRows = service.formatForCSV(visibleRows, ticketMap);

      // Generate CSV content
      const csvContent = service.exportToCSV(csvRows);

      // Download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      const now = new Date();
      const timestamp = now.toISOString().split('T')[0];
      link.setAttribute('href', url);
      link.setAttribute('download', `tickets-export-${timestamp}.csv`);
      link.style.visibility = 'hidden';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : 'No se pudo exportar el archivo.';
      setError(message);
      console.error('Export error:', err);
    }
  };

  // KPI data for cards
  const requestKpiCards = useMemo(() => {
    if (!metrics) return [];
    return [
      {
        value: metrics.totalTickets,
        label: 'Solicitudes',
        icon: '📋',
        color: 'primary' as const,
      },
      {
        value: metrics.totalExitTickets,
        label: 'Solicitudes de salida',
        icon: '📤',
        color: 'danger' as const,
      },
      {
        value: metrics.totalEntryTickets,
        label: 'Solicitudes de entrada',
        icon: '📥',
        color: 'success' as const,
      },
      {
        value: metrics.pendingApprovalCount,
        label: 'Pendientes de resolución',
        icon: '⏳',
        color: 'warning' as const,
      },
      {
        value: metrics.rejectedTicketCount,
        label: 'Rechazadas',
        icon: '🚫',
        color: 'danger' as const,
      },
    ];
  }, [metrics]);

  const movementKpiCards = useMemo(() => {
    if (!metrics) return [];
    return [
      {
        value: metrics.appliedMovementCount,
        label: 'Movimientos aplicados',
        icon: '✅',
        color: 'success' as const,
      },
      {
        value: metrics.totalQuantityMoved,
        label: 'Unidades movidas',
        icon: '📦',
        color: 'primary' as const,
      },
      {
        value: metrics.avgApprovalTimeHours,
        label: 'Tiempo promedio hasta aplicar (h)',
        icon: '⏱️',
        color: 'warning' as const,
      },
    ];
  }, [metrics]);

  const availableAreas = useMemo(
    () => Array.from(new Set(ticketRows.map((ticket) => ticket.area).filter((area) => area !== 'Sin área'))).sort(),
    [ticketRows]
  );

  if (loading && !metrics) {
    return (
      <div className="analytics-dashboard">
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <p>Cargando datos de análisis...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <h1>📊 Panel de análisis de inventario</h1>
        <p>Consulta solicitudes, movimientos aplicados y cantidades confirmadas.</p>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            backgroundColor: '#f8d7da',
            border: '1px solid #f5c6cb',
            color: '#721c24',
            padding: '12px 16px',
            borderRadius: '4px',
            marginBottom: '16px',
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="filter-bar">
        <div className="filter-group">
          <label>Fecha inicial</label>
          <input
            type="date"
            value={dateRangeStart}
            onChange={(e) => setDateRangeStart(e.target.value)}
            className="filter-input"
          />
        </div>

        <div className="filter-group">
          <label>Fecha final</label>
          <input
            type="date"
            value={dateRangeEnd}
            onChange={(e) => setDateRangeEnd(e.target.value)}
            className="filter-input"
          />
        </div>

        <div className="filter-group">
          <label>Tipo de solicitud</label>
          <select
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value as TicketType | 'ALL' })}
            className="filter-select"
          >
            <option value="ALL">Todos</option>
            <option value="EXIT">Solo salidas</option>
            <option value="ENTRY">Solo entradas</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Área</label>
          <select
            value={filters.area}
            onChange={(e) => setFilters({ ...filters, area: e.target.value })}
            className="filter-select"
          >
            <option value="ALL">Todas las áreas</option>
            {availableAreas.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Estado</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as TicketStatus | 'ALL' | 'PENDING_APPROVAL' })}
            className="filter-select"
          >
            <option value="ALL">Todos</option>
            <option value="PENDING_APPROVAL">Pendientes de resolución</option>
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

        <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
          <label style={{ visibility: 'hidden', height: '12px' }}>Aplicar</label>
          <button
            onClick={handleDateRangeChange}
            className="btn btn-primary"
            disabled={loading}
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      {/* Loading state for filters */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
          Actualizando datos...
        </div>
      )}

      {/* KPI Row */}
      {metrics && (
        <>
          <section className="analytics-section">
            <h2 className="analytics-section-title">Solicitudes</h2>
            <div className="kpi-row">
              {requestKpiCards.map((kpi) => (
                <KPICard key={kpi.label} data={kpi} icon={kpi.icon} color={kpi.color} />
              ))}
            </div>
          </section>

          <section className="analytics-section">
            <h2 className="analytics-section-title">Movimientos de inventario confirmados</h2>
            <p className="analytics-section-description">
              Las cantidades de esta sección solo incluyen tickets con el movimiento aplicado y registrado.
            </p>
            <div className="kpi-row">
              {movementKpiCards.map((kpi) => (
                <KPICard key={kpi.label} data={kpi} icon={kpi.icon} color={kpi.color} />
              ))}
            </div>
          </section>

          {/* Charts Row */}
          <div className="charts-row">
            <DailyVolumeChart data={metrics.dailyVolume} height={300} />
            <AreaDistributionChart data={metrics.movementByLocation} height={300} />
          </div>

          {/* Tables Row */}
          <div className="tables-row">
            <TopProductsTable data={metrics.topProducts} />
            <MotivoBreakdownTable data={metrics.movementByMotivo} />
          </div>

          {/* Products By Location */}
          <div style={{ marginTop: '24px', marginBottom: '24px' }}>
            <ProductsByLocationWidget productsByLocation={metrics.productsByLocation} />
          </div>

          {/* Full-width Tickets Table */}
          <TicketsTable data={ticketRows} onExport={handleExportCSV} />
        </>
      )}
    </div>
  );
}

export default AnalyticsDashboard;
