const {ticketDb: db, FieldValue} = require("../config/firebase");
const {STATUS} = require("./stock.service");
const {getProductById} = require("./inventory-api.service");
const {ensureLocationRecord} = require("./location.service");

function serializeFirestoreTimestamp(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (typeof value === 'object' && value._seconds != null && value._nanoseconds != null) {
    return new Date(value._seconds * 1000 + Math.floor(value._nanoseconds / 1e6)).toISOString()
  }
  return null
}

function serializeTicketData(data) {
  if (!data || typeof data !== 'object') return data
  return {
    ...data,
    createdAt: serializeFirestoreTimestamp(data.createdAt),
    updatedAt: serializeFirestoreTimestamp(data.updatedAt),
  }
}

function serializeTicketDoc(doc) {
  if (!doc || typeof doc.data !== 'function') return null
  return {
    id: doc.id,
    ...serializeTicketData(doc.data()),
  }
}

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

  const safeMetadata = {...(metadata || {})};

  // Preserve the inventory API area as provided by the frontend.
  // Only canonicalize destino into ubicaciones.
  if (safeMetadata.destino) {
    const destinoRecord = await ensureLocationRecord(safeMetadata.destino);
    safeMetadata.destino = destinoRecord.name || safeMetadata.destino;
  }

  const ticketRef = db.collection("tickets").doc();
  await ticketRef.set({
    type,
    status: STATUS.CREATED,
    items,
    assignedUsers: Array.isArray(assignedUsers) ? assignedUsers : [],
    requestedBy,
    metadata: safeMetadata,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {id: ticketRef.id};
}

async function updateTicket(ticketId, userId, updateData) {
  const ticketRef = db.collection("tickets").doc(ticketId);

  // Validate items before transaction
  if (updateData.items) {
    if (!Array.isArray(updateData.items) || !updateData.items.length) {
      throw new Error("Debes enviar al menos un item en items.");
    }
    for (const item of updateData.items) {
      const productId = item.productId || item.id || item.sku;
      const qty = Number(item.qty);
      if (!productId || !Number.isFinite(qty) || qty <= 0) {
        throw new Error("Cada item debe incluir productId y qty > 0.");
      }
    }
  }

  if (updateData.type && !["ENTRY", "EXIT"].includes(updateData.type)) {
    throw new Error("type debe ser ENTRY o EXIT.");
  }

  const safeMetadata = {...(updateData.metadata || {})};
  if (safeMetadata.destino) {
    const destinoRecord = await ensureLocationRecord(safeMetadata.destino);
    safeMetadata.destino = destinoRecord.name || safeMetadata.destino;
  }

  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) {
      throw new Error("Ticket no encontrado.");
    }

    const ticket = ticketDoc.data();
    if (ticket.status !== STATUS.CREATED && ticket.status !== STATUS.PENDING_CORRECTION) {
      throw new Error("Solo se puede editar un ticket en estado CREADO o PENDIENTE_CORRECCION.");
    }

    if (ticket.requestedBy !== userId) {
      throw new Error("No tienes permiso para editar este ticket.");
    }

    const updates = { updatedAt: FieldValue.serverTimestamp() };
    if (updateData.items) updates.items = updateData.items;
    if (updateData.type) updates.type = updateData.type;
    if (Object.keys(safeMetadata).length > 0) {
      // Merge with existing metadata
      updates.metadata = { ...(ticket.metadata || {}), ...safeMetadata };
    }

    trx.update(ticketRef, updates);
  });
}

async function sendToReview(ticketId, requestedBy, clientToken) {
  const ticketRef = db.collection("tickets").doc(ticketId);

  // Read ticket first to validate stock (avoid holding firestore transaction while calling external API)
  const ticketDocSnap = await ticketRef.get();
  if (!ticketDocSnap.exists) {
    throw new Error("Ticket no encontrado.");
  }

  const ticket = ticketDocSnap.data();
  if (ticket.status !== STATUS.CREATED && ticket.status !== STATUS.PENDING_CORRECTION) {
    throw new Error("Solo se puede enviar a revision un ticket en estado CREADO o PENDIENTE_CORRECCION.");
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
    if (fresh.status !== STATUS.CREATED && fresh.status !== STATUS.PENDING_CORRECTION) {
      throw new Error("Solo se puede enviar a revision un ticket en estado CREADO o PENDIENTE_CORRECCION.");
    }

    trx.update(ticketRef, {
      status: STATUS.IN_REVIEW,
      reviewSentBy: requestedBy,
      reviewSentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      correctionComment: FieldValue.delete(),
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
    if (ticket.status !== STATUS.IN_REVIEW && ticket.status !== STATUS.CREATED) {
      throw new Error("Solo se puede rechazar un ticket en CREADO o EN_REVISION.");
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

async function returnToCreator(ticketId, approverUserId, comment) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) {
      throw new Error("Ticket no encontrado.");
    }

    const ticket = ticketDoc.data();
    if (ticket.status !== STATUS.IN_REVIEW && ticket.status !== STATUS.CREATED) {
      throw new Error("Solo se puede devolver un ticket en CREADO o EN_REVISION.");
    }

    trx.update(ticketRef, {
      status: STATUS.PENDING_CORRECTION,
      correctionComment: comment || "",
      correctionSentBy: approverUserId,
      correctionSentAt: FieldValue.serverTimestamp(),
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

  return serializeTicketDoc(doc);
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
  const tickets = snapshot.docs.map((d) => serializeTicketDoc(d));

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
  updateTicket,
  sendToReview,
  rejectTicket,
  returnToCreator,
  markNotified,
  markNotificationError,
  getTicket,
  listTickets,
  listTicketsByUser,
};

async function listTicketsByUser(userId, limitCount = 50) {
  const snapshot = await db.collection("tickets")
    .where("requestedBy", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(limitCount)
    .get();

  return snapshot.docs.map((d) => serializeTicketDoc(d));
}
