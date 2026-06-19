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
} from '../types/analytics.types';
import '../components/styles/analytics.css';

/**
 * Get current month date range
 */
function getCurrentMonthDateRange() {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
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

        const computedMetrics = await service.computeMetrics(filters);
        const fetchedTickets = await service.fetchTickets(filters);

        setMetrics(computedMetrics);
        setTickets(fetchedTickets);

        const rows = service.formatTicketsForTable(fetchedTickets);
        setTicketRows(rows);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : 'Failed to fetch data';
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

    if (newStartDate >= newEndDate) {
      setError('Start date must be before end date');
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
      const message = err instanceof Error ? err.message : 'Export failed';
      setError(message);
      console.error('Export error:', err);
    }
  };

  // KPI data for cards
  const kpiCards = useMemo(() => {
    if (!metrics) return [];
    return [
      {
        value: metrics.totalTickets,
        label: 'Total Tickets',
        icon: '📋',
        color: 'primary' as const,
      },
      {
        value: metrics.totalExitTickets,
        label: 'EXIT Tickets',
        icon: '📤',
        color: 'danger' as const,
      },
      {
        value: metrics.totalEntryTickets,
        label: 'ENTRY Tickets',
        icon: '📥',
        color: 'success' as const,
      },
      {
        value: metrics.avgApprovalTimeHours,
        label: 'Avg Approval Time (hrs)',
        icon: '⏱️',
        color: 'warning' as const,
      },
    ];
  }, [metrics]);

  if (loading && !metrics) {
    return (
      <div className="analytics-dashboard">
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <p>Loading analytics data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <h1>📊 Ticket Analytics Dashboard</h1>
        <p>Comprehensive overview of ticket movements, trends, and metrics</p>
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
          <label>Start Date</label>
          <input
            type="date"
            value={dateRangeStart}
            onChange={(e) => setDateRangeStart(e.target.value)}
            className="filter-input"
          />
        </div>

        <div className="filter-group">
          <label>End Date</label>
          <input
            type="date"
            value={dateRangeEnd}
            onChange={(e) => setDateRangeEnd(e.target.value)}
            className="filter-input"
          />
        </div>

        <div className="filter-group">
          <label>Type</label>
          <select
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value as any })}
            className="filter-select"
          >
            <option value="ALL">All</option>
            <option value="EXIT">EXIT Only</option>
            <option value="ENTRY">ENTRY Only</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Area</label>
          <select
            value={filters.area}
            onChange={(e) => setFilters({ ...filters, area: e.target.value })}
            className="filter-select"
          >
            <option value="ALL">All Areas</option>
            {metrics?.movementByArea.map((area) => (
              <option key={area.area} value={area.area}>
                {area.area}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
            className="filter-select"
          >
            <option value="ALL">All</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="PENDIENTE">Pending</option>
            <option value="ENVIADO">Sent</option>
            <option value="APROBADO">Approved</option>
            <option value="NOTIFICADO">Notified</option>
            <option value="RECHAZADO">Rejected</option>
          </select>
        </div>

        <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
          <label style={{ visibility: 'hidden', height: '12px' }}>Action</label>
          <button
            onClick={handleDateRangeChange}
            className="btn btn-primary"
            disabled={loading}
          >
            Apply Filters
          </button>
        </div>
      </div>

      {/* Loading state for filters */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
          Updating data...
        </div>
      )}

      {/* KPI Row */}
      {metrics && (
        <>
          <div className="kpi-row">
            {kpiCards.map((kpi) => (
              <KPICard key={kpi.label} data={kpi} icon={kpi.icon} color={kpi.color} />
            ))}
          </div>

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
