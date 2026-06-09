const {db, FieldValue} = require("../config/firebase");
const {metricsStore} = require("./metrics.service");

/**
 * Add an audit entry to Firestore and record event in metrics.
 * 
 * @param {string} ticketId - Ticket identifier
 * @param {string} action - Action type (e.g., "TICKET_CREATED", "TICKET_REJECTED")
 * @param {string} user - User ID or email performing the action
 * @param {Object} [payload={}] - Additional context for the action
 */
async function addAuditEntry(ticketId, action, user, payload = {}) {
  const ref = db.collection("ticketAudits").doc();
  await ref.set({
    ticketId,
    action,
    user,
    payload,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Record event in metrics store for real-time dashboard
  const severity = action.includes("ERROR") || action.includes("REJECT") ? "warn" : "info";
  metricsStore.recordEvent(
    action,
    severity,
    `${action} on ticket ${ticketId}`,
    {ticketId, user, ...payload}
  );
}

module.exports = {
  addAuditEntry,
};
