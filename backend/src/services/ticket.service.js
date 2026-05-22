const {db, FieldValue} = require("../config/firebase");
const {STATUS} = require("./stock.service");
const {getProductById} = require("./inventory-api.service");

async function createTicket({type, items, assignedUsers, requestedBy, metadata}) {
  if (!["ENTRY", "EXIT"].includes(type)) {
    throw new Error("type debe ser ENTRY o EXIT.");
  }

  if (!Array.isArray(items) || !items.length) {
    throw new Error("Debes enviar al menos un item en items.");
  }

  for (const item of items) {
    const productId = item.productId || item.id || item.sku;
    const qty = Number(item.qty);
    if (!productId || !Number.isFinite(qty) || qty <= 0) {
      throw new Error("Cada item debe incluir productId (o sku legacy) y qty > 0.");
    }
  }

  const ticketRef = db.collection("tickets").doc();
  await ticketRef.set({
    type,
    status: STATUS.CREATED,
    items,
    assignedUsers: Array.isArray(assignedUsers) ? assignedUsers : [],
    requestedBy,
    metadata: metadata || {},
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {id: ticketRef.id};
}

async function sendToReview(ticketId, requestedBy, clientToken) {
  const ticketRef = db.collection("tickets").doc(ticketId);

  // Read ticket first to validate stock (avoid holding firestore transaction while calling external API)
  const ticketDocSnap = await ticketRef.get();
  if (!ticketDocSnap.exists) {
    throw new Error("Ticket no encontrado.");
  }

  const ticket = ticketDocSnap.data();
  if (ticket.status !== STATUS.CREATED) {
    throw new Error("Solo se puede enviar a revision un ticket en estado CREADO.");
  }

  // For EXIT tickets, validate stock availability before sending to review
  if (ticket.type === "EXIT") {
    const items = Array.isArray(ticket.items) ? ticket.items : [];
    for (const item of items) {
      const productId = item.productId || item.id || item.sku;
      const qty = Number(item.qty);
      if (!productId || !Number.isFinite(qty) || qty <= 0) {
        throw new Error("Cada item debe incluir productId (o sku legacy) y qty > 0.");
      }

      try {
        const detail = await getProductById(productId, clientToken);
        console.log(`[sendToReview] Full API response for ${productId}:`, JSON.stringify(detail, null, 2));
        
        const product = detail?.data || detail || {};
        console.log(`[sendToReview] Extracted product for ${productId}:`, JSON.stringify(product, null, 2));
        
        // Try multiple stock field names
        let currentStock = 0;
        const stockKeys = ['stock', 'Stock', 'STOCK', 'cantidad', 'Cantidad', 'CANTIDAD', 'existencias', 'Existencias', 'disponible', 'Disponible'];
        for (const key of stockKeys) {
          if (product[key] !== undefined && product[key] !== null) {
            currentStock = Number(product[key]);
            console.log(`[sendToReview] Found stock in field '${key}': ${currentStock}`);
            if (currentStock >= 0) break;
          }
        }
        
        console.log(`[sendToReview] Final stock for ${productId}: ${currentStock}, requested: ${qty}`);

        if (currentStock < qty) {
          throw new Error(
            `Stock insuficiente para producto ${productId}. Disponible: ${currentStock}, solicitado: ${qty}.`,
          );
        }
      } catch (apiError) {
        throw new Error(
          `Error validando stock para ${productId}: ${apiError.message}`,
        );
      }
    }
  }

  // All validations passed — now update status inside a transaction to avoid races
  await db.runTransaction(async (trx) => {
    const freshDoc = await trx.get(ticketRef);
    if (!freshDoc.exists) {
      throw new Error("Ticket no encontrado.");
    }
    const fresh = freshDoc.data();
    if (fresh.status !== STATUS.CREATED) {
      throw new Error("Solo se puede enviar a revision un ticket en estado CREADO.");
    }

    trx.update(ticketRef, {
      status: STATUS.IN_REVIEW,
      reviewSentBy: requestedBy,
      reviewSentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function rejectTicket(ticketId, approverUserId, comment) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) {
      throw new Error("Ticket no encontrado.");
    }

    const ticket = ticketDoc.data();
    if (ticket.status !== STATUS.IN_REVIEW) {
      throw new Error("Solo se puede rechazar un ticket en EN_REVISION.");
    }

    trx.update(ticketRef, {
      status: STATUS.REJECTED,
      reviewedBy: approverUserId,
      reviewComment: comment || "",
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function markNotified(ticketId) {
  await db.collection("tickets").doc(ticketId).update({
    status: STATUS.NOTIFIED,
    notificationStatus: "SENT",
    notificationSentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function markNotificationError(ticketId, errorMessage) {
  await db.collection("tickets").doc(ticketId).update({
    notificationStatus: "ERROR",
    notificationError: errorMessage,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function getTicket(ticketId) {
  const doc = await db.collection("tickets").doc(ticketId).get();
  if (!doc.exists) {
    return null;
  }

  return {id: doc.id, ...doc.data()};
}

async function listTickets({status, area, limitCount = 100} = {}) {
  // Use where() alone (no orderBy) to avoid requiring a composite index.
  // Sorting is done in-memory after fetching.
  let query = db.collection("tickets");

  if (status) {
    query = query.where("status", "==", status).limit(limitCount);
  } else {
    query = query.limit(limitCount);
  }

  const snapshot = await query.get();
  const tickets = snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    };
  });

  // Sort descending by createdAt in memory
  tickets.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })

  // Filter by area in memory if needed (Firestore doesn't support nested field filter easily)
  if (area) {
    return tickets.filter((t) => {
      const ticketArea = t.metadata?.area || "";
      return ticketArea.toLowerCase() === area.toLowerCase();
    });
  }
  return tickets;
}

module.exports = {
  createTicket,
  sendToReview,
  rejectTicket,
  markNotified,
  markNotificationError,
  getTicket,
  listTickets,
  listTicketsByUser,
};

async function listTicketsByUser(userId, limitCount = 50) {
  const snapshot = await db.collection("tickets")
    .where("requestedBy", "==", userId)
    .limit(limitCount)
    .get();

  const tickets = snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    };
  });

  tickets.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  return tickets;
}
