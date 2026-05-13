const {db, FieldValue} = require("../config/firebase");
const {
  getProductById,
  discountProduct,
  reingressProduct,
} = require("./inventory-api.service");

const STATUS = {
  CREATED: "CREADO",
  IN_REVIEW: "EN_REVISION",
  REJECTED: "RECHAZADO",
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

  for (const item of normalizedItems) {
    let apiResult;

    if (ticket.type === "ENTRY") {
      // The /reingreso endpoint adds the given qty to existing stock — pass item.qty directly.
      apiResult = await reingressProduct(
          item.productId,
          item.qty,
          item.reason || ticket.metadata?.motivo,
          clientToken,
      );
    } else {
      // For EXIT: fetch current stock first to validate sufficiency.
      const detail = await getProductById(item.productId, clientToken);
      const product = detail?.data || detail || {};
      const currentStock = Number(product.stock ?? product.Stock ?? product.cantidad ?? 0);

      if (currentStock < item.qty) {
        throw new Error(
            `Stock insuficiente para producto ${item.productId}. ` +
            `Disponible: ${currentStock}, solicitado: ${item.qty}.`,
        );
      }
      // The /descontar endpoint subtracts the given qty from existing stock.
      apiResult = await discountProduct(item.productId, item.qty, clientToken);
    }

    movementResults.push({
      ...item,
      operation: ticket.type === "ENTRY" ? "reingreso" : "descuento",
      response: apiResult?.data || apiResult,
    });
  }

  return movementResults;
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
