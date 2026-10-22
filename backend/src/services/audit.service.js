const {ticketDb: db, FieldValue} = require("../config/firebase");
const {logger, sanitize} = require("./observability.service");
const {alertManager} = require("./alert.service");

/**
 * Add an audit entry to Firestore and record event in metrics.
 * 
 * @param {string} ticketId - Ticket identifier
 * @param {string} action - Action type (e.g., "TICKET_CREATED", "TICKET_REJECTED")
 * @param {string} user - User ID or email performing the action
 * @param {Object} [payload={}] - Additional context for the action
 */
async function addAuditEntry(ticketId, action, user, payload = {}) {
  let persisted = true;
  try {
    const ref = db.collection("ticketAudits").doc();
    await ref.set({
      ticketId,
      action,
      user,
      payload,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    persisted = false;
    logger.error("No se pudo persistir una entrada de auditoria", {
      eventType: "AUDIT_PERSISTENCE_FAILED",
      module: "audit",
      ticketId,
      requestId: payload.requestId,
      correlationId: payload.correlationId,
      metadata: {action},
    }, error);
    alertManager.trigger({
      type: "AUDIT_PERSISTENCE_FAILED",
      severity: "ERROR",
      summary: "No se pudo persistir un evento de auditoria de ticket",
      ticketId,
      module: "audit",
      dedupeKey: `AUDIT_PERSISTENCE_FAILED:${ticketId}:${action}`,
    });
  }

  const level = action.includes("ERROR") || action.includes("REJECT") ? "warn" : "info";
  logger[level](`Evento de ticket: ${action}`, {
    eventType: action,
    module: "tickets",
    ticketId,
    requestId: payload.requestId,
    correlationId: payload.correlationId,
    metadata: sanitize({actorId: user, ...payload}),
  });
  return persisted;
}

module.exports = {
  addAuditEntry,
};
