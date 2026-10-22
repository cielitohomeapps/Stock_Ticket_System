const {ticketDb: db, FieldValue} = require("../config/firebase");
const {
  getProductById,
  discountProduct,
  reingressProduct,
} = require("./inventory-api.service");
const {logger} = require("./observability.service");
const {alertManager} = require("./alert.service");
const {normalizeStockReconciliationDecision} = require("./ticket-integrity.service");

const STATUS = {
  CREATED: "CREADO",
  IN_REVIEW: "EN_REVISION",
  REJECTED: "RECHAZADO",
  PENDING_CORRECTION: "PENDIENTE_CORRECCION",
  STOCK_UPDATED: "STOCK_ACTUALIZADO",
  NOTIFIED: "NOTIFICADO",
};

const STOCK_LOCK_TTL_MS = Number(process.env.STOCK_LOCK_TTL_MS || 120000);

function serviceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function markOutcomeUnknown(error) {
  const failure = error instanceof Error ? error : new Error(String(error));
  failure.stockOutcomeUnknown = true;
  return failure;
}

async function acquireStockLock(ticketId) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  const movementRef = db.collection("stockMovements").doc(`ticket_${ticketId}`);

  let ticketData = null;
  let isAlreadyApplied = false;
  let staleLockDetected = false;

  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) {
      throw serviceError("Ticket no encontrado.", 404, "TICKET_NOT_FOUND");
    }

    ticketData = {id: ticketId, ...ticketDoc.data()};
    if (ticketData.stockSyncStatus === "UNKNOWN") {
      throw serviceError(
          "El resultado del movimiento de inventario es incierto. Verifica el sistema de inventarios antes de tomar otra acción.",
          409,
          "STOCK_OUTCOME_UNKNOWN",
      );
    }

    const movementDoc = await trx.get(movementRef);
    if (movementDoc.exists || ticketData.status === STATUS.STOCK_UPDATED || ticketData.status === STATUS.NOTIFIED) {
      if (movementDoc.exists && ticketData.status === STATUS.IN_REVIEW) {
        throw serviceError(
            "Existe un movimiento registrado, pero el ticket no refleja su estado final. Se requiere conciliación administrativa.",
            409,
            "STOCK_RECORD_INCONSISTENT",
        );
      }
      isAlreadyApplied = true;
      return;
    }

    if (ticketData.status !== STATUS.IN_REVIEW) {
      throw serviceError("El ticket debe estar en revisión para aprobarse.", 409, "INVALID_TICKET_STATE");
    }

    if (ticketData.stockProcessing) {
      const lockAt = ticketData.stockProcessingAt;
      const lockAtMs = typeof lockAt?.toMillis === "function" ? lockAt.toMillis() : null;
      const lockIsFresh = lockAtMs && (Date.now() - lockAtMs) < STOCK_LOCK_TTL_MS;

      if (lockIsFresh) {
        throw serviceError("Este ticket ya se esta procesando.", 409, "STOCK_PROCESSING");
      }
      trx.update(ticketRef, {
        stockProcessing: false,
        stockSyncStatus: "UNKNOWN",
        stockError: "El proceso de inventario quedó interrumpido; confirma el resultado en el sistema de inventarios antes de reintentar.",
        stockOutcomeUnknownAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      staleLockDetected = true;
      return;
    }

    trx.update(ticketRef, {
      stockProcessing: true,
      stockProcessingAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  if (staleLockDetected) {
    throw serviceError(
        "El procesamiento anterior quedó interrumpido y su resultado no puede confirmarse automáticamente. Verifica el inventario antes de reintentar.",
        409,
        "STOCK_OUTCOME_UNKNOWN",
    );
  }
  return {ticketData, isAlreadyApplied};
}

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw serviceError("El ticket no contiene productos.", 400, "INVALID_TICKET");
  }

  return items.map((item) => {
    const productId = item.productId || item.id || item.sku;
    const qty = Number(item.qty);

    if (!productId || !Number.isFinite(qty) || qty <= 0) {
      throw serviceError("Cada producto debe tener identificador y una cantidad mayor que cero.", 400, "INVALID_TICKET");
    }

    return {
      productId,
      qty,
      area: item.area || "",
      reason: item.reason || "",
      productName: item.productName || item.nombre || "",
    };
  });
}

async function refreshStockLock(ticketId) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) {
      throw serviceError("Ticket no encontrado.", 404, "TICKET_NOT_FOUND");
    }
    const ticket = ticketDoc.data();
    if (ticket.status !== STATUS.IN_REVIEW || !ticket.stockProcessing || ticket.stockSyncStatus === "UNKNOWN") {
      throw serviceError(
          "El estado del ticket cambio durante el procesamiento de inventario.",
          409,
          ticket.stockSyncStatus === "UNKNOWN" ? "STOCK_OUTCOME_UNKNOWN" : "INVALID_TICKET_STATE",
      );
    }
    trx.update(ticketRef, {
      stockProcessingAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function processInventoryMovements(ticket, clientToken) {
  const normalizedItems = normalizeItems(ticket.items || []);
  const movementResults = [];
  const processedItems = [];

  try {
    for (const item of normalizedItems) {
      await refreshStockLock(ticket.id);
      let apiResult;

      if (ticket.type === "ENTRY") {
        // The /reingreso endpoint adds the given qty to existing stock — pass item.qty directly.
        logger.info("Aplicando reingreso de inventario", {
          eventType: "INVENTORY_ENTRY_STARTED", module: "inventory", ticketId: ticket.id,
          metadata: {productId: item.productId, qty: item.qty},
        });
        try {
          apiResult = await reingressProduct(
              item.productId,
              item.qty,
              item.reason || ticket.metadata?.motivo,
              clientToken,
          );
        } catch (error) {
          throw markOutcomeUnknown(error);
        }
        processedItems.push({ item, op: 'ENTRY' });
      } else {
        // For EXIT: fetch current stock first to validate sufficiency.
        const detail = await getProductById(item.productId, clientToken);
        
        const product = detail?.data || detail || {};
        
        // Try multiple stock field names
        let currentStock = null;
        const stockKeys = ['stock', 'Stock', 'STOCK', 'cantidad', 'Cantidad', 'CANTIDAD', 'existencias', 'Existencias', 'disponible', 'Disponible'];
        for (const key of stockKeys) {
          if (product[key] !== undefined && product[key] !== null) {
            const candidate = Number(product[key]);
            if (Number.isFinite(candidate) && candidate >= 0) {
              currentStock = candidate;
              break;
            }
          }
        }
        if (currentStock === null) {
          throw serviceError(
              `El inventario no devolvió stock válido para el producto ${item.productId}.`,
              502,
              "INVALID_INVENTORY_RESPONSE",
          );
        }
        
        if (currentStock < item.qty) {
          throw serviceError(
              `Stock insuficiente para producto ${item.productId}. ` +
              `Disponible: ${currentStock}, solicitado: ${item.qty}.`,
              409,
              "INSUFFICIENT_STOCK",
          );
        }
        
        // The /descontar endpoint subtracts the given qty from existing stock.
        logger.info("Aplicando descuento de inventario", {
          eventType: "INVENTORY_EXIT_STARTED", module: "inventory", ticketId: ticket.id,
          metadata: {productId: item.productId, qty: item.qty},
        });
        try {
          apiResult = await discountProduct(
              item.productId,
              item.qty,
              item.reason || ticket.metadata?.motivo,
              clientToken,
          );
        } catch (error) {
          throw markOutcomeUnknown(error);
        }
        processedItems.push({ item, op: 'EXIT' });
      }

      movementResults.push({
        ...item,
        operation: ticket.type === "ENTRY" ? "reingreso" : "descuento",
        providerResult: {
          ok: apiResult?.ok !== false,
          status: apiResult?.status || apiResult?.data?.status || "ACCEPTED",
          reference: apiResult?.id || apiResult?.data?.id || null,
        },
      });
    }

    return movementResults;
  } catch (error) {
    let compensationFailed = false;
    if (processedItems.length) {
      logger.error("Fallo un movimiento de inventario; se inicia compensacion", {
        eventType: "INVENTORY_MOVEMENT_FAILED",
        module: "inventory",
        ticketId: ticket.id,
        metadata: {processedCount: processedItems.length},
      }, error);
      for (const record of processedItems) {
        try {
          if (record.op === 'ENTRY') {
            await discountProduct(
              record.item.productId,
              record.item.qty,
              'Rollback por fallo en ticket',
              clientToken,
            );
          } else {
            await reingressProduct(
              record.item.productId,
              record.item.qty,
              'Rollback por fallo en ticket',
              clientToken,
            );
          }
        } catch (rollbackError) {
          compensationFailed = true;
          logger.fatal("Fallo la compensacion de inventario", {
            eventType: "INVENTORY_ROLLBACK_FAILED",
            module: "inventory",
            ticketId: ticket.id,
            metadata: {productId: record.item.productId, operation: record.op},
          }, rollbackError);
          alertManager.trigger({
            type: "INVENTORY_ROLLBACK_FAILED",
            severity: "FATAL",
            summary: "Fallo la compensacion de un movimiento de inventario",
            ticketId: ticket.id,
            module: "inventory",
            dedupeKey: `INVENTORY_ROLLBACK_FAILED:${ticket.id}:${record.item.productId}`,
          });
        }
      }
    }
    if (compensationFailed) throw markOutcomeUnknown(error);
    throw error;
  }
}

async function finalizeSuccess(ticketId, approverUserId, movementResults) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  const movementRef = db.collection("stockMovements").doc(`ticket_${ticketId}`);

  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    const movementDoc = await trx.get(movementRef);
    if (!ticketDoc.exists) {
      throw new Error("Ticket no encontrado al finalizar el movimiento de inventario.");
    }
    const ticket = ticketDoc.data();
    if (ticket.status !== STATUS.IN_REVIEW || !ticket.stockProcessing) {
      throw new Error("El ticket cambio de estado durante el movimiento de inventario.");
    }
    if (!movementDoc.exists) {
      trx.set(movementRef, {
        ticketId,
        source: "inventory-api",
        items: movementResults,
        approvedBy: approverUserId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    trx.update(ticketRef, {
      status: STATUS.STOCK_UPDATED,
      approvedBy: approverUserId,
      approvedAt: FieldValue.serverTimestamp(),
      stockMovementId: movementRef.id,
      stockProcessing: false,
      stockError: FieldValue.delete(),
      stockSyncStatus: FieldValue.delete(),
      stockOutcomeUnknownAt: FieldValue.delete(),
      stockOutcomeResolution: "APPLIED",
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function finalizeFailure(ticketId, errorMessage, outcomeUnknown) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  await ticketRef.update({
    stockProcessing: false,
    stockError: outcomeUnknown
      ? "El resultado del movimiento no pudo confirmarse. Verifica el sistema de inventarios antes de reintentar."
      : errorMessage,
    stockSyncStatus: outcomeUnknown ? "UNKNOWN" : FieldValue.delete(),
    stockOutcomeUnknownAt: outcomeUnknown ? FieldValue.serverTimestamp() : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function applyStockMovementForTicket(ticketId, approverUserId, clientToken) {
  const {ticketData, isAlreadyApplied} = await acquireStockLock(ticketId);
  if (isAlreadyApplied) {
    return;
  }

  try {
    const movementResults = await processInventoryMovements(ticketData, clientToken);
    try {
      await finalizeSuccess(ticketId, approverUserId, movementResults);
    } catch (error) {
      throw markOutcomeUnknown(error);
    }
  } catch (error) {
    await finalizeFailure(ticketId, error.message, error.stockOutcomeUnknown === true);
    throw error;
  }
}

async function reconcileUnknownStockMovement(ticketId, adminUserId, input) {
  const {decision, reason} = normalizeStockReconciliationDecision(input);
  const ticketRef = db.collection("tickets").doc(ticketId);
  const movementRef = db.collection("stockMovements").doc(`ticket_${ticketId}`);
  const auditRef = db.collection("ticketAudits").doc();

  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    const movementDoc = await trx.get(movementRef);
    if (!ticketDoc.exists) {
      throw serviceError("Ticket no encontrado.", 404, "TICKET_NOT_FOUND");
    }
    const ticket = ticketDoc.data();
    if (ticket.status !== STATUS.IN_REVIEW || ticket.stockSyncStatus !== "UNKNOWN" || ticket.stockProcessing) {
      throw serviceError(
          "El ticket ya no está pendiente de conciliación de inventario.",
          409,
          "STOCK_RECONCILIATION_NOT_REQUIRED",
      );
    }
    if (movementDoc.exists) {
      throw serviceError(
          "Ya existe un movimiento registrado para este ticket. Revisa la integridad del registro antes de conciliar.",
          409,
          "STOCK_RECORD_INCONSISTENT",
      );
    }

    const timestamp = FieldValue.serverTimestamp();
    if (decision === "APPLIED") {
      const items = normalizeItems(ticket.items || []).map((item) => ({
        ...item,
        operation: ticket.type === "ENTRY" ? "reingreso" : "descuento",
        providerResult: {
          ok: true,
          status: "MANUALLY_VERIFIED",
          reference: null,
        },
      }));
      trx.create(movementRef, {
        ticketId,
        source: "manual-reconciliation",
        items,
        approvedBy: adminUserId,
        status: "MANUALLY_RECONCILED",
        reconciliationReason: reason,
        createdAt: timestamp,
      });
      trx.update(ticketRef, {
        status: STATUS.STOCK_UPDATED,
        approvedBy: adminUserId,
        approvedAt: timestamp,
        stockMovementId: movementRef.id,
        stockProcessing: false,
        stockError: FieldValue.delete(),
        stockSyncStatus: FieldValue.delete(),
        stockOutcomeUnknownAt: FieldValue.delete(),
        stockOutcomeResolution: "APPLIED",
        updatedAt: timestamp,
      });
    } else {
      trx.update(ticketRef, {
        stockProcessing: false,
        stockError: FieldValue.delete(),
        stockSyncStatus: FieldValue.delete(),
        stockOutcomeUnknownAt: FieldValue.delete(),
        stockOutcomeResolution: "NOT_APPLIED",
        updatedAt: timestamp,
      });
    }

    trx.create(auditRef, {
      ticketId,
      action: "STOCK_OUTCOME_RECONCILED",
      user: adminUserId,
      payload: {
        decision,
        reason,
        previousStatus: ticket.status,
        resultingStatus: decision === "APPLIED" ? STATUS.STOCK_UPDATED : STATUS.IN_REVIEW,
      },
      createdAt: timestamp,
    });
  });

  logger.info("Resultado incierto de inventario conciliado por administrador", {
    eventType: "STOCK_OUTCOME_RECONCILED",
    module: "inventory",
    ticketId,
    userId: adminUserId,
    metadata: {decision},
  });
  return {
    ticketId,
    status: decision === "APPLIED" ? STATUS.STOCK_UPDATED : STATUS.IN_REVIEW,
    decision,
  };
}

module.exports = {
  STATUS,
  applyStockMovementForTicket,
  reconcileUnknownStockMovement,
};
