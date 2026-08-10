const {ticketDb: db, FieldValue} = require("../config/firebase");
const {
  getProductById,
  discountProduct,
  reingressProduct,
} = require("./inventory-api.service");

const STATUS = {
  CREATED: "CREADO",
  IN_REVIEW: "EN_REVISION",
  REJECTED: "RECHAZADO",
  PENDING_CORRECTION: "PENDIENTE_CORRECCION",
  STOCK_UPDATED: "STOCK_ACTUALIZADO",
  NOTIFIED: "NOTIFICADO",
};

const STOCK_LOCK_TTL_MS = Number(process.env.STOCK_LOCK_TTL_MS || 120000);

async function acquireStockLock(ticketId) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  const movementRef = db.collection("stockMovements").doc(`ticket_${ticketId}`);

  let ticketData = null;
  let isAlreadyApplied = false;

  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) {
      throw new Error("Ticket no encontrado.");
    }

    ticketData = ticketDoc.data();

    const movementDoc = await trx.get(movementRef);
    if (movementDoc.exists || ticketData.status === STATUS.STOCK_UPDATED || ticketData.status === STATUS.NOTIFIED) {
      isAlreadyApplied = true;
      return;
    }

    if (ticketData.status !== STATUS.IN_REVIEW) {
      throw new Error("El ticket debe estar EN_REVISION para aprobarse.");
    }

    if (ticketData.stockProcessing) {
      const lockAt = ticketData.stockProcessingAt;
      const lockAtMs = typeof lockAt?.toMillis === "function" ? lockAt.toMillis() : null;
      const lockIsFresh = lockAtMs && (Date.now() - lockAtMs) < STOCK_LOCK_TTL_MS;

      if (lockIsFresh) {
        throw new Error("Este ticket ya se esta procesando.");
      }
    }

    trx.update(ticketRef, {
      stockProcessing: true,
      stockProcessingAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {ticketData, isAlreadyApplied};
}

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("El ticket no contiene items.");
  }

  return items.map((item) => {
    const productId = item.productId || item.id || item.sku;
    const qty = Number(item.qty);

    if (!productId || !Number.isFinite(qty) || qty <= 0) {
      throw new Error("Items invalidos: productId y qty > 0 son obligatorios.");
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

async function processInventoryMovements(ticket, clientToken) {
  const normalizedItems = normalizeItems(ticket.items || []);
  const movementResults = [];
  const processedItems = [];

  try {
    for (const item of normalizedItems) {
      let apiResult;

      if (ticket.type === "ENTRY") {
        // The /reingreso endpoint adds the given qty to existing stock — pass item.qty directly.
        console.log(`[processInventoryMovements] Calling reingressProduct for ${item.productId}, qty: ${item.qty}, reason: ${item.reason}`);
        apiResult = await reingressProduct(
            item.productId,
            item.qty,
            item.reason || ticket.metadata?.motivo,
            clientToken,
        );
        console.log(`[processInventoryMovements] reingressProduct response:`, JSON.stringify(apiResult, null, 2));
        processedItems.push({ item, op: 'ENTRY' });
      } else {
        // For EXIT: fetch current stock first to validate sufficiency.
        console.log(`[processInventoryMovements] Fetching product ${item.productId}`);
        const detail = await getProductById(item.productId, clientToken);
        console.log(`[processInventoryMovements] Full API response for ${item.productId}:`, JSON.stringify(detail, null, 2));
        
        const product = detail?.data || detail || {};
        console.log(`[processInventoryMovements] Extracted product for ${item.productId}:`, JSON.stringify(product, null, 2));
        
        // Try multiple stock field names
        let currentStock = 0;
        const stockKeys = ['stock', 'Stock', 'STOCK', 'cantidad', 'Cantidad', 'CANTIDAD', 'existencias', 'Existencias', 'disponible', 'Disponible'];
        for (const key of stockKeys) {
          if (product[key] !== undefined && product[key] !== null) {
            currentStock = Number(product[key]);
            console.log(`[processInventoryMovements] Found stock in field '${key}': ${currentStock}`);
            if (currentStock >= 0) break;
          }
        }
        
        console.log(`[processInventoryMovements] Final stock for ${item.productId}: ${currentStock}, requested: ${item.qty}`);

        if (currentStock < item.qty) {
          throw new Error(
              `Stock insuficiente para producto ${item.productId}. ` +
              `Disponible: ${currentStock}, solicitado: ${item.qty}.`,
          );
        }
        
        // The /descontar endpoint subtracts the given qty from existing stock.
        console.log(`[processInventoryMovements] Calling discountProduct for ${item.productId}, qty: ${item.qty}, reason: ${item.reason}`);
        apiResult = await discountProduct(
            item.productId,
            item.qty,
            item.reason || ticket.metadata?.motivo,
            clientToken,
        );
        console.log(`[processInventoryMovements] discountProduct response:`, JSON.stringify(apiResult, null, 2));
        processedItems.push({ item, op: 'EXIT' });
      }

      movementResults.push({
        ...item,
        operation: ticket.type === "ENTRY" ? "reingreso" : "descuento",
        response: apiResult?.data || apiResult,
      });
    }

    return movementResults;
  } catch (error) {
    if (processedItems.length) {
      console.error('Error en movimiento, iniciando rollback de productos procesados:', error.message);
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
          console.error(`FALLO CRÍTICO DE ROLLBACK para producto ${record.item.productId}:`, rollbackError.message);
        }
      }
    }
    throw error;
  }
}

async function finalizeSuccess(ticketId, approverUserId, movementResults) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  const movementRef = db.collection("stockMovements").doc(`ticket_${ticketId}`);

  await db.runTransaction(async (trx) => {
    const movementDoc = await trx.get(movementRef);
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
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Fallback: When stock sync fails but we have validated stock,
 * mark the ticket as approved with a partial sync status.
 * This allows business continuity while recording the error.
 */
async function finalizeSuccessPartial(ticketId, approverUserId, movementResults, syncErrorMessage) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  const movementRef = db.collection("stockMovements").doc(`ticket_${ticketId}`);
  const syncErrorRef = db.collection("stockSyncErrors").doc(`ticket_${ticketId}`);

  await db.runTransaction(async (trx) => {
    // Record the partial movement attempt
    const movementDoc = await trx.get(movementRef);
    if (!movementDoc.exists) {
      trx.set(movementRef, {
        ticketId,
        source: "inventory-api-partial",
        items: movementResults,
        approvedBy: approverUserId,
        status: "PARTIAL_SYNC_ERROR",
        error: syncErrorMessage,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Record the sync error for retry/manual review
    trx.set(syncErrorRef, {
      ticketId,
      error: syncErrorMessage,
      movementAttempt: movementResults,
      createdAt: FieldValue.serverTimestamp(),
      requiresManualReview: true,
    });

    // Update ticket as approved despite sync error
    trx.update(ticketRef, {
      status: STATUS.STOCK_UPDATED,
      approvedBy: approverUserId,
      approvedAt: FieldValue.serverTimestamp(),
      stockMovementId: movementRef.id,
      stockProcessing: false,
      stockError: syncErrorMessage, // Keep error for reference
      stockSyncWarning: "Stock sync failed - manual review may be needed",
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function finalizeFailure(ticketId, errorMessage) {
  await db.collection("tickets").doc(ticketId).update({
    stockProcessing: false,
    stockError: errorMessage,
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
    await finalizeSuccess(ticketId, approverUserId, movementResults);
  } catch (error) {
    await finalizeFailure(ticketId, error.message);
    throw error;
  }
}

module.exports = {
  STATUS,
  applyStockMovementForTicket,
};
