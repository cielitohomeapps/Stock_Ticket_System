const {ticketDb: db} = require("../config/firebase");
const {evaluateTicketIntegrity} = require("./ticket-integrity.service");
const {logger} = require("./observability.service");
const {alertManager} = require("./alert.service");

async function scanTicketIntegrity({limit = 200, emitEvents = false} = {}) {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  const snapshot = await db.collection("tickets").limit(safeLimit).get();
  const incomplete = [];
  for (const doc of snapshot.docs) {
    const result = evaluateTicketIntegrity({id: doc.id, ...doc.data()});
    if (!result.complete) {
      incomplete.push({ticketId: doc.id, severity: result.severity, issues: result.issues});
      if (emitEvents) {
        logger.warn("Ticket con inconsistencia de integridad", {
          eventType: "TICKET_INTEGRITY_WARNING",
          module: "integrity",
          ticketId: doc.id,
          metadata: {issues: result.issues},
        });
        alertManager.trigger({
          type: "TICKET_INTEGRITY_WARNING",
          severity: result.severity,
          summary: `Ticket con ${result.issues.length} inconsistencia(s) de integridad`,
          ticketId: doc.id,
          module: "integrity",
          dedupeKey: `TICKET_INTEGRITY_WARNING:${doc.id}`,
        });
      }
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    scanned: snapshot.docs.length,
    incompleteCount: incomplete.length,
    incomplete,
  };
}

function startIntegrityMonitor() {
  const intervalMs = Number(process.env.INTEGRITY_CHECK_INTERVAL_MS || 300000);
  if (!Number.isFinite(intervalMs) || intervalMs < 30000) return null;
  const run = () => scanTicketIntegrity({emitEvents: true}).catch((error) => {
    logger.error("Fallo la verificacion programada de integridad", {
      eventType: "INTEGRITY_SCAN_FAILED",
      module: "integrity",
    }, error);
    alertManager.trigger({
      type: "INTEGRITY_SCAN_FAILED",
      severity: "ERROR",
      summary: "No fue posible verificar la integridad de tickets",
      module: "integrity",
    });
  });
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, Math.min(10000, intervalMs)).unref?.();
  return timer;
}

module.exports = {scanTicketIntegrity, startIntegrityMonitor};
