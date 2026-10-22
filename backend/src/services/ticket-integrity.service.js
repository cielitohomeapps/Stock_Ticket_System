const MAX_ITEMS = Number(process.env.TICKET_MAX_ITEMS || 100);
const KNOWN_STATUSES = new Set([
  "CREADO",
  "EN_REVISION",
  "RECHAZADO",
  "PENDIENTE_CORRECCION",
  "STOCK_ACTUALIZADO",
  "NOTIFICADO",
]);

class TicketValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "TicketValidationError";
    this.code = "INVALID_TICKET";
    this.statusCode = 400;
    this.details = details;
  }
}

function requiredText(value, field, maxLength, issues) {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${field} es obligatorio.`);
    return "";
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    issues.push(`${field} excede ${maxLength} caracteres.`);
  }
  return normalized.slice(0, maxLength);
}

function normalizeDate(value, issues) {
  const normalized = requiredText(value, "metadata.fecha", 10, issues);
  if (!normalized) return normalized;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    issues.push("metadata.fecha debe usar el formato YYYY-MM-DD.");
    return normalized;
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    issues.push("metadata.fecha no es una fecha valida.");
  }
  return normalized;
}

function normalizeTicketPayload(payload = {}) {
  const issues = [];
  const type = typeof payload.type === "string" ? payload.type.trim().toUpperCase() : "";
  if (!["ENTRY", "EXIT"].includes(type)) {
    issues.push("type debe ser ENTRY o EXIT.");
  }

  const inputItems = Array.isArray(payload.items) ? payload.items : [];
  if (inputItems.length === 0) issues.push("Debes enviar al menos un item.");
  if (inputItems.length > MAX_ITEMS) issues.push(`No se permiten mas de ${MAX_ITEMS} items.`);

  const seenProducts = new Set();
  const items = inputItems.slice(0, MAX_ITEMS).map((item, index) => {
    const productId = String(item?.productId || item?.id || item?.sku || "").trim();
    const qty = Number(item?.qty);
    const suppliedName = item?.name || item?.nombre || item?.productName || productId;
    const name = String(suppliedName || "").trim().slice(0, 200);

    if (!productId) issues.push(`items[${index}].productId es obligatorio.`);
    if (productId.length > 200) issues.push(`items[${index}].productId excede 200 caracteres.`);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isSafeInteger(qty)) {
      issues.push(`items[${index}].qty debe ser un entero mayor que cero.`);
    }
    if (productId && seenProducts.has(productId)) {
      issues.push(`El producto ${productId} esta duplicado.`);
    }
    seenProducts.add(productId);

    return {productId: productId.slice(0, 200), name, qty};
  });

  const rawMetadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const metadata = {
    area: requiredText(rawMetadata.area, "metadata.area", 120, issues),
    motivo: requiredText(rawMetadata.motivo, "metadata.motivo", 500, issues),
    firma: requiredText(rawMetadata.firma, "metadata.firma", 200, issues),
    destino: requiredText(rawMetadata.destino, "metadata.destino", 200, issues),
    fecha: normalizeDate(rawMetadata.fecha, issues),
  };

  const assignedUsers = Array.isArray(payload.assignedUsers)
    ? [...new Set(payload.assignedUsers.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 50)
    : [];

  if (issues.length) {
    throw new TicketValidationError("El ticket esta incompleto o contiene datos invalidos.", issues);
  }

  return {type, items, assignedUsers, metadata};
}

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object" && value._seconds != null) {
    return Number(value._seconds) * 1000 + Math.floor(Number(value._nanoseconds || 0) / 1e6);
  }
  return null;
}

function evaluateTicketIntegrity(ticket, options = {}) {
  const issues = [];
  try {
    normalizeTicketPayload(ticket);
  } catch (error) {
    issues.push(...(error.details || [error.message]));
  }

  if (!ticket?.requestedBy) issues.push("requestedBy es obligatorio.");
  if (!KNOWN_STATUSES.has(ticket?.status)) issues.push("status es desconocido o esta ausente.");
  if (!timestampToMillis(ticket?.createdAt)) issues.push("createdAt esta ausente o no es valido.");

  if (ticket?.status === "EN_REVISION" && !timestampToMillis(ticket?.reviewSentAt)) {
    issues.push("El ticket esta EN_REVISION sin reviewSentAt.");
  }
  if (ticket?.submissionState === "SUBMITTED" && ticket?.status === "CREADO") {
    issues.push("El ticket figura enviado pero permanece en CREADO.");
  }
  if (ticket?.stockSyncStatus === "UNKNOWN") {
    issues.push("El resultado del movimiento de inventario requiere conciliacion manual.");
  }
  if (ticket?.status === "NOTIFICADO" && ticket?.notificationStatus === "ERROR") {
    issues.push("El ticket figura notificado aunque la notificacion fallo.");
  }

  const nowMs = options.nowMs || Date.now();
  const lockThresholdMs = options.lockThresholdMs || Number(process.env.STOCK_LOCK_TTL_MS || 120000);
  const processingAt = timestampToMillis(ticket?.stockProcessingAt);
  if (ticket?.stockProcessing && (!processingAt || nowMs - processingAt > lockThresholdMs)) {
    issues.push("El procesamiento de stock excedio el umbral configurado.");
  }
  const reviewThresholdMs = options.reviewThresholdMs || Number(process.env.TICKET_REVIEW_STALE_MS || 86400000);
  const reviewStartedAt = timestampToMillis(ticket?.reviewSentAt);
  if (ticket?.status === "EN_REVISION" && reviewStartedAt && nowMs - reviewStartedAt > reviewThresholdMs) {
    issues.push("El ticket permanece EN_REVISION mas alla del umbral configurado.");
  }

  return {
    complete: issues.length === 0,
    severity: issues.some((issue) => issue.includes("stock") || issue.includes("enviado")) ? "ERROR" : "WARN",
    issues,
  };
}

function canAccessTicket(ticket, user) {
  if (!ticket || !user) return false;
  return Boolean(user.esAdminLevel || ticket.requestedBy === user.id);
}

function normalizeStockReconciliationDecision({decision, reason} = {}) {
  const normalizedDecision = typeof decision === "string" ? decision.trim().toUpperCase() : "";
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  const issues = [];

  if (!["APPLIED", "NOT_APPLIED"].includes(normalizedDecision)) {
    issues.push("decision debe ser APPLIED o NOT_APPLIED.");
  }
  if (!normalizedReason) issues.push("reason es obligatorio.");
  if (normalizedReason.length > 500) issues.push("reason no puede exceder 500 caracteres.");

  if (issues.length) {
    const error = new Error("La conciliación requiere una decisión válida y una justificación.");
    error.statusCode = 400;
    error.code = "INVALID_STOCK_RECONCILIATION";
    error.details = issues;
    throw error;
  }
  return {decision: normalizedDecision, reason: normalizedReason};
}

module.exports = {
  TicketValidationError,
  normalizeTicketPayload,
  evaluateTicketIntegrity,
  timestampToMillis,
  canAccessTicket,
  normalizeStockReconciliationDecision,
};
