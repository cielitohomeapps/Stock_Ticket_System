/**
 * @fileoverview Ticket analytics data service.
 * Fetches and aggregates ticket data from Firestore.
 */

import type {
  Ticket,
  TicketType,
  TicketStatus,
  DashboardMetrics,
  DashboardFilters,
  ProductMovement,
  AreaMovement,
  MotivoBreakdown,
  DailyVolume,
  TicketTableRow,
  CSVExportRow,
} from '../types/analytics.types';

let analyticsService: TicketAnalyticsService | null = null;

export function initializeAnalyticsService(apiBase: string, token: string | null) {
  analyticsService = new TicketAnalyticsService(apiBase, token);
}

export function getAnalyticsService() {
  if (!analyticsService) {
    throw new Error('Analytics service not initialized');
  }
  return analyticsService;
}

/**
 * Ticket Analytics Data Service
 * Provides methods to fetch, filter, and aggregate ticket data from Firestore.
 */
export class TicketAnalyticsService {
  private apiBase: string;
  private token: string | null;

  constructor(apiBase: string, token: string | null) {
    this.apiBase = apiBase.replace(/\/$/, '');
    this.token = token;
  }

  /**
   * Convert Firestore Timestamp to Date
   */
  private toDate(timestamp: any): Date {
    if (!timestamp) return new Date();
    if (timestamp instanceof Date) return timestamp;
    if (timestamp?.toDate) return timestamp.toDate();
    return new Date(timestamp);
  }

  /**
   * Fetch all tickets matching the filter criteria via backend admin API
   */
  async fetchTickets(filters: DashboardFilters): Promise<Ticket[]> {
    const query = new URLSearchParams();
    query.set('startDate', filters.dateRange.startDate.toISOString());
    query.set('endDate', filters.dateRange.endDate.toISOString());
    query.set('type', filters.type);
    query.set('area', filters.area);
    query.set('status', filters.status);

    const url = `${this.apiBase}/admin/analytics/tickets?${query.toString()}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token || ''}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Analytics fetch failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = await response.json();
    return Array.isArray(data?.tickets) ? data.tickets : [];
  }

  /**
   * Calculate average approval time in hours
   */
  private calculateApprovalTime(tickets: Ticket[]): number {
    const ticketsWithApproval = tickets.filter((t) => t.approvedAt);
    if (ticketsWithApproval.length === 0) return 0;

    const totalHours = ticketsWithApproval.reduce((sum, ticket) => {
      const createdTime = this.toDate(ticket.createdAt).getTime();
      const approvedTime = this.toDate(ticket.approvedAt!).getTime();
      return sum + (approvedTime - createdTime) / (1000 * 60 * 60);
    }, 0);

    return Math.round((totalHours / ticketsWithApproval.length) * 100) / 100;
  }

  /**
   * Aggregate top 10 products by total quantity moved
   */
  private aggregateTopProducts(tickets: Ticket[]): ProductMovement[] {
    const productMap = new Map<string, ProductMovement>();

    tickets.forEach((ticket) => {
      ticket.items.forEach((item) => {
        const existing = productMap.get(item.productId) || {
          productId: item.productId,
          productName: item.name,
          exitQty: 0,
          entryQty: 0,
          netBalance: 0,
          totalMoved: 0,
        };

        if (ticket.type === 'EXIT') {
          existing.exitQty += item.qty;
          existing.netBalance -= item.qty;
        } else {
          existing.entryQty += item.qty;
          existing.netBalance += item.qty;
        }
        existing.totalMoved += item.qty;

        productMap.set(item.productId, existing);
      });
    });

    return Array.from(productMap.values())
      .sort((a, b) => b.totalMoved - a.totalMoved)
      .slice(0, 10);
  }

  /**
   * Aggregate movement counts by area
   */
  private aggregateByArea(tickets: Ticket[]): AreaMovement[] {
    const areaMap = new Map<string, number>();

    tickets.forEach((ticket) => {
      const area = ticket.metadata.area || 'Unknown';
      areaMap.set(area, (areaMap.get(area) || 0) + 1);
    });

    const total = tickets.length;
    return Array.from(areaMap.entries())
      .map(([area, count]) => ({
        area,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Aggregate movement counts by location
   */
  private aggregateByLocation(tickets: Ticket[]): AreaMovement[] {
    const locationMap = new Map<string, number>();

    tickets.forEach((ticket) => {
      const location = ticket.metadata.destino || 'Unknown';
      locationMap.set(location, (locationMap.get(location) || 0) + 1);
    });

    const total = tickets.length;
    return Array.from(locationMap.entries())
      .map(([area, count]) => ({
        area,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Aggregate movement counts by motivo (reason)
   */
  private aggregateByMotivo(tickets: Ticket[]): MotivoBreakdown[] {
    const motivoMap = new Map<string, number>();

    tickets.forEach((ticket) => {
      const motivo = ticket.metadata.motivo || 'Unknown';
      motivoMap.set(motivo, (motivoMap.get(motivo) || 0) + 1);
    });

    const total = tickets.length;
    return Array.from(motivoMap.entries())
      .map(([motivo, count]) => ({
        motivo,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Aggregate products by location
   */
  private aggregateProductsByLocation(tickets: Ticket[]): Record<string, ProductMovement[]> {
    const locationProductMap = new Map<string, Map<string, ProductMovement>>();

    tickets.forEach((ticket) => {
      const location = ticket.metadata.destino || 'Unknown';
      if (!locationProductMap.has(location)) {
        locationProductMap.set(location, new Map<string, ProductMovement>());
      }
      const productMap = locationProductMap.get(location)!;

      ticket.items?.forEach((item) => {
        const existing = productMap.get(item.productId) || {
          productId: item.productId,
          productName: item.name,
          exitQty: 0,
          entryQty: 0,
          netBalance: 0,
          totalMoved: 0,
        };

        if (ticket.type === 'EXIT') {
          existing.exitQty += item.qty;
          existing.netBalance -= item.qty;
        } else {
          existing.entryQty += item.qty;
          existing.netBalance += item.qty;
        }
        existing.totalMoved += item.qty;

        productMap.set(item.productId, existing);
      });
    });

    const result: Record<string, ProductMovement[]> = {};
    locationProductMap.forEach((productMap, location) => {
      result[location] = Array.from(productMap.values())
        .sort((a, b) => b.totalMoved - a.totalMoved);
    });

    return result;
  }

  /**
   * Generate daily volume time series
   */
  private generateDailyVolume(tickets: Ticket[], dateRange: { startDate: Date; endDate: Date }): DailyVolume[] {
    const dateMap = new Map<string, { exitCount: number; entryCount: number }>();

    // Initialize all dates in range
    const current = new Date(dateRange.startDate);
    while (current <= dateRange.endDate) {
      const dateStr = this.formatDateISO(current);
      dateMap.set(dateStr, { exitCount: 0, entryCount: 0 });
      current.setDate(current.getDate() + 1);
    }

    // Populate with ticket data
    tickets.forEach((ticket) => {
      const dateStr = this.formatDateISO(this.toDate(ticket.createdAt));
      const existing = dateMap.get(dateStr);
      if (existing) {
        if (ticket.type === 'EXIT') {
          existing.exitCount += 1;
        } else {
          existing.entryCount += 1;
        }
      }
    });

    return Array.from(dateMap.entries())
      .map(([date, { exitCount, entryCount }]) => ({
        date,
        exitCount,
        entryCount,
        totalCount: exitCount + entryCount,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  /**
   * Format date as ISO string (YYYY-MM-DD)
   */
  private formatDateISO(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Compute complete dashboard metrics
   */
  async computeMetrics(filters: DashboardFilters): Promise<DashboardMetrics> {
    const tickets = await this.fetchTickets(filters);

    const totalTickets = tickets.length;
    const totalExitTickets = tickets.filter((t) => t.type === 'EXIT').length;
    const totalEntryTickets = tickets.filter((t) => t.type === 'ENTRY').length;
    const pendingApprovalCount = tickets.filter(
      (t) => t.status !== 'APROBADO' && t.status !== 'NOTIFICADO'
    ).length;

    return {
      totalTickets,
      totalExitTickets,
      totalEntryTickets,
      exitPercentage: totalTickets > 0 ? Math.round((totalExitTickets / totalTickets) * 100) : 0,
      entryPercentage: totalTickets > 0 ? Math.round((totalEntryTickets / totalTickets) * 100) : 0,
      avgApprovalTimeHours: this.calculateApprovalTime(tickets),
      pendingApprovalCount,
      topProducts: this.aggregateTopProducts(tickets),
      totalProductsMoved: tickets.reduce((sum, t) => sum + (t.items?.length || 0), 0),
      movementByArea: this.aggregateByArea(tickets),
      movementByLocation: this.aggregateByLocation(tickets),
      movementByMotivo: this.aggregateByMotivo(tickets),
      productsByLocation: this.aggregateProductsByLocation(tickets),
      dailyVolume: this.generateDailyVolume(tickets, filters.dateRange),
      dateRange: filters.dateRange,
      filteredCount: totalTickets,
    };
  }

  /**
   * Convert tickets to table display format
   */
  formatTicketsForTable(tickets: Ticket[]): TicketTableRow[] {
    return tickets.map((ticket) => {
      const items = ticket.items || [];
      const itemsPreview = items
        .slice(0, 2)
        .map((i) => `${i.name} (${i.qty})`)
        .join(', ');
      const productsSummary =
        items.length > 2
          ? `${items.length} products: ${itemsPreview}...`
          : `${items.length} products: ${itemsPreview}`;

      const approvalTimeHours = ticket.approvedAt
        ? Math.round((this.toDate(ticket.approvedAt).getTime() - this.toDate(ticket.createdAt).getTime()) / (1000 * 60 * 60) * 100) / 100
        : undefined;

      return {
        id: ticket.id,
        createdDate: this.formatDisplayDate(this.toDate(ticket.createdAt)),
        type: ticket.type,
        productsSummary,
        area: ticket.metadata.area || 'N/A',
        destino: ticket.metadata.destino || 'N/A',
        firma: ticket.metadata.firma || 'N/A',
        status: ticket.status,
        approvalTimeHours,
        requestedBy: ticket.requestedBy || 'Unknown',
      };
    });
  }

  /**
   * Convert table rows to CSV format
   */
  formatForCSV(rows: TicketTableRow[], originalTickets: Map<string, Ticket>): CSVExportRow[] {
    return rows.map((row) => {
      const ticket = originalTickets.get(row.id);
      const productIds = ticket?.items.map((i) => i.productId).join('; ') || '';
      const itemsList = ticket?.items.map((i) => `${i.name}:${i.qty}`).join('; ') || '';

      return {
        ...row,
        productIds,
        itemsList,
      };
    });
  }

  /**
   * Export data to CSV string
   */
  exportToCSV(rows: CSVExportRow[]): string {
    const headers = [
      'Date',
      'Type',
      'Products',
      'Area',
      'Destination',
      'Signature',
      'Status',
      'Approval Time (hrs)',
      'Requested By',
      'Product IDs',
      'Items',
    ];

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        [
          `"${row.createdDate}"`,
          row.type,
          `"${row.productsSummary}"`,
          `"${row.area}"`,
          `"${row.destino}"`,
          `"${row.firma}"`,
          row.status,
          row.approvalTimeHours?.toString() || 'N/A',
          `"${row.requestedBy}"`,
          `"${row.productIds}"`,
          `"${row.itemsList}"`,
        ].join(',')
      ),
    ].join('\n');

    return csvContent;
  }

  /**
   * Format date for display (MM/DD/YYYY HH:MM)
   */
  private formatDisplayDate(date: Date): string {
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  /**
   * Get list of unique areas
   */
  async fetchUniqueAreas(): Promise<string[]> {
    // For now, return empty array - can be implemented to query all unique areas
    // This would require a separate query or cached data
    return [];
  }

  /**
   * Get list of unique statuses
   */
  async fetchUniqueStatuses(): Promise<TicketStatus[]> {
    return ['PENDIENTE', 'ENVIADO', 'APROBADO', 'NOTIFICADO', 'RECHAZADO'];
  }
}

