/**
 * @fileoverview TypeScript interfaces and types for analytics dashboard.
 * Defines all data structures used in ticket analytics and reporting.
 */

/** Ticket type: EXIT (outgoing) or ENTRY (incoming) */
export type TicketType = 'EXIT' | 'ENTRY';

/** Ticket status options */
export type TicketStatus = 'PENDIENTE' | 'ENVIADO' | 'APROBADO' | 'NOTIFICADO' | 'RECHAZADO';

/** Single item within a ticket */
export interface TicketItem {
  name: string;
  productId: string;
  qty: number;
}

/** Ticket metadata */
export interface TicketMetadata {
  area: string;
  destino: string;
  fecha: string;
  firma: string;
  motivo: string;
}

/** Raw ticket document from Firestore */
export interface Ticket {
  id: string;
  type: TicketType;
  status: TicketStatus;
  items: TicketItem[];
  metadata: TicketMetadata;
  createdAt: Date | { toDate(): Date }; // Firestore Timestamp or Date
  approvedAt?: Date | { toDate(): Date };
  approvedBy?: string;
  requestedBy: string;
  reviewSentBy?: string;
  assignedUsers: string[];
  notificationStatus: string;
  stockMovementId: string;
  stockProcessing: boolean;
}

/** Aggregated product movement data */
export interface ProductMovement {
  productId: string;
  productName: string;
  exitQty: number;
  entryQty: number;
  netBalance: number;
  totalMoved: number;
}

/** Area movement breakdown */
export interface AreaMovement {
  area: string;
  count: number;
  percentage: number;
}

/** Motivo (reason) breakdown */
export interface MotivoBreakdown {
  motivo: string;
  count: number;
  percentage: number;
}

/** Daily volume data point */
export interface DailyVolume {
  date: string; // YYYY-MM-DD format
  exitCount: number;
  entryCount: number;
  totalCount: number;
}

/** KPI card data */
export interface KPIData {
  value: number;
  label: string;
  change?: number;
  changePercent?: number;
}

/** Main dashboard metrics object */
export interface DashboardMetrics {
  // Summary KPIs
  totalTickets: number;
  totalExitTickets: number;
  totalEntryTickets: number;
  exitPercentage: number;
  entryPercentage: number;
  avgApprovalTimeHours: number;
  pendingApprovalCount: number;

  // Product data
  topProducts: ProductMovement[];
  totalProductsMoved: number;

  // Area & Motivo
  movementByArea: AreaMovement[];
  movementByLocation: AreaMovement[];
  movementByMotivo: MotivoBreakdown[];
  productsByLocation: Record<string, ProductMovement[]>;

  // Time series
  dailyVolume: DailyVolume[];

  // Metadata
  dateRange: {
    startDate: Date;
    endDate: Date;
  };
  filteredCount: number;
}

/** Filter options for dashboard */
export interface DashboardFilters {
  dateRange: {
    startDate: Date;
    endDate: Date;
  };
  type: 'EXIT' | 'ENTRY' | 'ALL';
  area: string | 'ALL';
  status: TicketStatus | 'ALL' | 'PENDING_APPROVAL';
}

/** Ticket table row data (for display) */
export interface TicketTableRow {
  id: string;
  createdDate: string; // Formatted date
  type: TicketType;
  productsSummary: string; // e.g., "3 products: Widget (10), Gadget (5)..."
  area: string;
  destino: string;
  firma: string;
  status: TicketStatus;
  approvalTimeHours?: number;
  requestedBy: string;
}

/** CSV export row (includes all columns + productId) */
export interface CSVExportRow extends TicketTableRow {
  productIds: string;
  itemsList: string;
}
