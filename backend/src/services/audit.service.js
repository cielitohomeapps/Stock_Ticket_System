const {db, FieldValue} = require("../config/firebase");

async function addAuditEntry(ticketId, action, user, payload = {}) {
  const ref = db.collection("ticketAudits").doc();
  await ref.set({
    ticketId,
    action,
    user,
    payload,
    createdAt: FieldValue.serverTimestamp(),
  });
}

module.exports = {
  addAuditEntry,
};
