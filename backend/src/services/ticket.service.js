const {ticketDb: db, FieldValue} = require("../config/firebase");
const {STATUS} = require("./stock.service");
const {getProductById} = require("./inventory-api.service");
const {resolveLocationRecord} = require("./location.service");
const {normalizeArea, extractProductArea} = require("./area-access.service");
const {
  normalizeTicketPayload,
  evaluateTicketIntegrity,
  normalizeReviewComment,
} = require("./ticket-integrity.service");
const {logger} = require("./observability.service");
const {alertManager} = require("./alert.service");
const {
  createIdempotencyDocumentId,
  createSubmissionFingerprint,
} = require("./idempotency.service");

function serviceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

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
  const normalized = normalizeTicketPayload({type, items, assignedUsers, metadata});
  const safeMetadata = {...normalized.metadata};

  // Preserve the inventory API area as provided by the frontend.
  // Only canonicalize destino into ubicaciones.
  if (safeMetadata.destino) {
    const destinoRecord = await resolveLocationRecord(safeMetadata.destino);
    safeMetadata.destino = destinoRecord.name;
  }

  const ticketRef = db.collection("tickets").doc();
  await ticketRef.set({
    type: normalized.type,
    status: STATUS.CREATED,
    submissionState: "DRAFT",
    items: normalized.items,
    assignedUsers: normalized.assignedUsers,
    requestedBy,
    metadata: safeMetadata,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {id: ticketRef.id, status: STATUS.CREATED};
}

function extractStock(product) {
  const source = product?.data || product || {};
  const keys = [
    "stock", "Stock", "STOCK", "cantidad", "Cantidad", "CANTIDAD",
    "existencias", "Existencias", "disponible", "Disponible",
    "cantidadDisponible", "stockActual", "quantity", "qty",
  ];
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      const value = Number(source[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

async function validateStockAvailability(ticket, clientToken) {
  for (const item of ticket.items) {
    let detail;
    try {
      detail = await getProductById(item.productId, clientToken, {allowServiceFallback: true});
    } catch (error) {
      throw serviceError(`No se pudo validar el inventario del producto ${item.productId}.`, 502, "INVENTORY_UNAVAILABLE");
    }
    const productArea = extractProductArea(detail);
    if (!productArea) {
      throw serviceError(`El inventario no devolvio un area valida para ${item.productId}.`, 502, "INVALID_INVENTORY_RESPONSE");
    }
    if (normalizeArea(productArea) !== normalizeArea(ticket.metadata?.area)) {
      throw serviceError(
          `El producto ${item.productId} no pertenece al area indicada en el ticket.`,
          400,
          "PRODUCT_AREA_MISMATCH",
      );
    }
    if (ticket.type !== "EXIT") continue;
    const currentStock = extractStock(detail);
    if (currentStock === null) {
      throw serviceError(`El inventario no devolvio stock valido para ${item.productId}.`, 502, "INVALID_INVENTORY_RESPONSE");
    }
    if (currentStock < item.qty) {
      throw serviceError(
          `Stock insuficiente para producto ${item.productId}. Disponible: ${currentStock}, solicitado: ${item.qty}.`,
          409,
          "INSUFFICIENT_STOCK",
      );
    }
  }
}

async function verifyPersistedTicket(ticketId) {
  const persisted = await getTicket(ticketId);
  if (!persisted) {
    const error = serviceError("No se pudo verificar el ticket persistido.", 500, "PERSISTENCE_VERIFICATION_FAILED");
    error.ticketId = ticketId;
    throw error;
  }
  const integrity = evaluateTicketIntegrity(persisted);
  if (!integrity.complete) {
    logger.error("La verificacion posterior detecto un ticket incompleto", {
      eventType: "TICKET_INTEGRITY_FAILED",
      module: "tickets",
      ticketId,
      metadata: {issues: integrity.issues},
    });
    alertManager.trigger({
      type: "TICKET_INTEGRITY_FAILED",
      severity: "ERROR",
      summary: "Un ticket persistido no supero la verificacion de integridad",
      ticketId,
      module: "tickets",
    });
    const error = serviceError("El ticket se guardo, pero fallo su verificacion de integridad.", 500, "PERSISTENCE_INTEGRITY_FAILED");
    error.ticketId = ticketId;
    throw error;
  }
  return persisted;
}

async function submitTicket({type, items, assignedUsers, requestedBy, metadata}, clientToken, idempotencyKey) {
  const normalized = normalizeTicketPayload({type, items, assignedUsers, metadata});
  const idempotencyDocumentId = createIdempotencyDocumentId(requestedBy, idempotencyKey);
  const payloadFingerprint = createSubmissionFingerprint(requestedBy, normalized);
  const submissionRef = db.collection("ticketSubmissionKeys").doc(idempotencyDocumentId);

  const existingSubmission = await submissionRef.get();
  if (existingSubmission.exists) {
    const existing = existingSubmission.data();
    if (existing.payloadFingerprint !== payloadFingerprint) {
      throw serviceError(
          "Esta solicitud ya se usó con otros datos. Revisa el historial antes de intentar enviar un ticket nuevo.",
          409,
          "IDEMPOTENCY_KEY_REUSED",
      );
    }
    const existingTicket = await getTicket(existing.ticketId);
    if (!existingTicket) {
      throw serviceError(
          "La solicitud ya fue registrada, pero no se pudo consultar su ticket. Contacta al administrador e indica el identificador de solicitud.",
          500,
          "IDEMPOTENCY_RECORD_INCONSISTENT",
      );
    }
    return {id: existingTicket.id, status: existingTicket.status, replayed: true};
  }

  await validateStockAvailability(normalized, clientToken);
  const safeMetadata = {...normalized.metadata};
  if (safeMetadata.destino) {
    const destinoRecord = await resolveLocationRecord(safeMetadata.destino);
    safeMetadata.destino = destinoRecord.name;
  }

  const ticketRef = db.collection("tickets").doc();
  let ticketId = ticketRef.id;
  await db.runTransaction(async (trx) => {
    const submissionDoc = await trx.get(submissionRef);
    if (submissionDoc.exists) {
      const existing = submissionDoc.data();
      if (existing.payloadFingerprint !== payloadFingerprint) {
        throw serviceError(
            "Esta solicitud ya se usó con otros datos. Revisa el historial antes de intentar enviar un ticket nuevo.",
            409,
            "IDEMPOTENCY_KEY_REUSED",
        );
      }
      ticketId = existing.ticketId;
      return;
    }

    const timestamp = FieldValue.serverTimestamp();
    trx.set(ticketRef, {
      ...normalized,
      metadata: safeMetadata,
      status: STATUS.IN_REVIEW,
      submissionState: "SUBMITTED",
      requestedBy,
      reviewSentBy: requestedBy,
      reviewSentAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    trx.create(submissionRef, {
      ticketId: ticketRef.id,
      requestedBy,
      payloadFingerprint,
      createdAt: timestamp,
    });
  });
  const persisted = await verifyPersistedTicket(ticketId);
  return {id: ticketId, status: persisted.status, replayed: ticketId !== ticketRef.id};
}

async function updateTicket(ticketId, userId, updateData) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  const normalized = normalizeTicketPayload(updateData);
  const safeMetadata = {...normalized.metadata};
  if (safeMetadata.destino) {
    const destinoRecord = await resolveLocationRecord(safeMetadata.destino);
    safeMetadata.destino = destinoRecord.name;
  }

  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) {
      throw new Error("Ticket no encontrado.");
    }

    const ticket = ticketDoc.data();
    if (ticket.status !== STATUS.CREATED && ticket.status !== STATUS.PENDING_CORRECTION) {
      throw serviceError("Solo se puede editar un ticket en estado CREADO o PENDIENTE_CORRECCION.", 409, "INVALID_TICKET_STATE");
    }

    if (ticket.requestedBy !== userId) {
      throw serviceError("No tienes permiso para editar este ticket.", 403, "TICKET_FORBIDDEN");
    }

    const updates = {
      ...normalized,
      metadata: safeMetadata,
      submissionState: "DRAFT",
      updatedAt: FieldValue.serverTimestamp(),
    };

    trx.update(ticketRef, updates);
  });
  return verifyPersistedTicket(ticketId);
}

async function updateAndSubmitTicket(ticketId, userId, updateData, clientToken) {
  const ticketRef = db.collection("tickets").doc(ticketId);
  const normalized = normalizeTicketPayload(updateData);
  await validateStockAvailability(normalized, clientToken);
  const safeMetadata = {...normalized.metadata};
  if (safeMetadata.destino) {
    const destinoRecord = await resolveLocationRecord(safeMetadata.destino);
    safeMetadata.destino = destinoRecord.name;
  }

  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) throw serviceError("Ticket no encontrado.", 404, "TICKET_NOT_FOUND");
    const ticket = ticketDoc.data();
    if (![STATUS.CREATED, STATUS.PENDING_CORRECTION].includes(ticket.status)) {
      throw serviceError("El ticket ya no se puede enviar desde su estado actual.", 409, "INVALID_TICKET_STATE");
    }
    if (ticket.requestedBy !== userId) {
      throw serviceError("No tienes permiso para enviar este ticket.", 403, "TICKET_FORBIDDEN");
    }
    trx.update(ticketRef, {
      ...normalized,
      metadata: safeMetadata,
      status: STATUS.IN_REVIEW,
      submissionState: "SUBMITTED",
      reviewSentBy: userId,
      reviewSentAt: FieldValue.serverTimestamp(),
      correctionComment: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const persisted = await verifyPersistedTicket(ticketId);
  return {id: ticketId, status: persisted.status};
}

async function sendToReview(ticketId, requestedBy, clientToken) {
  const ticketRef = db.collection("tickets").doc(ticketId);

  // Read ticket first to validate stock (avoid holding firestore transaction while calling external API)
  const ticketDocSnap = await ticketRef.get();
  if (!ticketDocSnap.exists) {
    throw new Error("Ticket no encontrado.");
  }

  const ticket = ticketDocSnap.data();
  if (ticket.requestedBy !== requestedBy) {
    throw serviceError("No tienes permiso para enviar este ticket a revision.", 403, "TICKET_FORBIDDEN");
  }
  if (ticket.status !== STATUS.CREATED && ticket.status !== STATUS.PENDING_CORRECTION) {
    throw serviceError(
        "Solo se puede enviar a revisión un ticket creado o pendiente de corrección.",
        409,
        "INVALID_TICKET_STATE",
    );
  }

  const normalized = normalizeTicketPayload(ticket);
  const destinoRecord = await resolveLocationRecord(normalized.metadata.destino);
  await validateStockAvailability(normalized, clientToken);
  const validatedStockRequest = JSON.stringify({
    type: normalized.type,
    items: normalized.items.map(({productId, qty}) => ({productId, qty})),
  });

  // All validations passed — now update status inside a transaction to avoid races
  await db.runTransaction(async (trx) => {
    const freshDoc = await trx.get(ticketRef);
    if (!freshDoc.exists) {
      throw new Error("Ticket no encontrado.");
    }
    const fresh = freshDoc.data();
    if (fresh.requestedBy !== requestedBy) {
      throw serviceError("No tienes permiso para enviar este ticket a revision.", 403, "TICKET_FORBIDDEN");
    }
    if (fresh.status !== STATUS.CREATED && fresh.status !== STATUS.PENDING_CORRECTION) {
      throw serviceError(
          "Solo se puede enviar a revisión un ticket creado o pendiente de corrección.",
          409,
          "INVALID_TICKET_STATE",
      );
    }
    const freshNormalized = normalizeTicketPayload(fresh);
    if (freshNormalized.metadata.destino !== normalized.metadata.destino) {
      throw serviceError(
          "El destino del ticket cambió durante la validación. Actualiza la pantalla y vuelve a enviarlo.",
          409,
          "TICKET_CHANGED_DURING_SUBMISSION",
      );
    }
    const currentStockRequest = JSON.stringify({
      type: freshNormalized.type,
      items: freshNormalized.items.map(({productId, qty}) => ({productId, qty})),
    });
    if (currentStockRequest !== validatedStockRequest) {
      throw serviceError(
          "El ticket cambio mientras se validaba el stock. Actualiza la pantalla y vuelve a enviarlo.",
          409,
          "TICKET_CHANGED_DURING_SUBMISSION",
      );
    }

    trx.update(ticketRef, {
      status: STATUS.IN_REVIEW,
      submissionState: "SUBMITTED",
      reviewSentBy: requestedBy,
      reviewSentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      correctionComment: FieldValue.delete(),
      "metadata.destino": destinoRecord.name,
    });
  });
}

async function rejectTicket(ticketId, approverUserId, comment) {
  const safeComment = normalizeReviewComment(comment);
  const ticketRef = db.collection("tickets").doc(ticketId);
  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) {
      throw new Error("Ticket no encontrado.");
    }

    const ticket = ticketDoc.data();
    if (ticket.status !== STATUS.IN_REVIEW) {
      throw serviceError("Solo se puede rechazar un ticket en EN_REVISION.", 409, "INVALID_TICKET_STATE");
    }
    if (ticket.stockProcessing || ticket.stockSyncStatus === "UNKNOWN") {
      throw serviceError(
          "No se puede rechazar este ticket mientras el resultado del movimiento de inventario se procesa o requiere verificacion.",
          409,
          ticket.stockSyncStatus === "UNKNOWN" ? "STOCK_OUTCOME_UNKNOWN" : "STOCK_PROCESSING",
      );
    }

    trx.update(ticketRef, {
      status: STATUS.REJECTED,
      reviewedBy: approverUserId,
      reviewComment: safeComment,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function returnToCreator(ticketId, approverUserId, comment) {
  const safeComment = normalizeReviewComment(comment);
  const ticketRef = db.collection("tickets").doc(ticketId);
  await db.runTransaction(async (trx) => {
    const ticketDoc = await trx.get(ticketRef);
    if (!ticketDoc.exists) {
      throw new Error("Ticket no encontrado.");
    }

    const ticket = ticketDoc.data();
    if (ticket.status !== STATUS.IN_REVIEW) {
      throw serviceError("Solo se puede devolver un ticket en EN_REVISION.", 409, "INVALID_TICKET_STATE");
    }
    if (ticket.stockProcessing || ticket.stockSyncStatus === "UNKNOWN") {
      throw serviceError(
          "No se puede devolver este ticket mientras el resultado del movimiento de inventario se procesa o requiere verificacion.",
          409,
          ticket.stockSyncStatus === "UNKNOWN" ? "STOCK_OUTCOME_UNKNOWN" : "STOCK_PROCESSING",
      );
    }

    trx.update(ticketRef, {
      status: STATUS.PENDING_CORRECTION,
      correctionComment: safeComment,
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
    notificationError: "No se pudo enviar la notificación.",
    notificationErrorType: errorMessage ? "PROVIDER_ERROR" : "UNKNOWN_ERROR",
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

async function listTickets({status, area, page = 1, pageSize = 25} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  let query = db.collection("tickets");
  if (status) query = query.where("status", "==", status);
  if (area) query = query.where("metadata.area", "==", area);
  query = query.orderBy("createdAt", "desc")
      .offset((safePage - 1) * safePageSize)
      .limit(safePageSize + 1);
  const snapshot = await query.get();
  const hasNext = snapshot.docs.length > safePageSize;
  return {
    tickets: snapshot.docs.slice(0, safePageSize).map((doc) => serializeTicketDoc(doc)),
    pagination: {page: safePage, pageSize: safePageSize, hasNext},
  };
}

module.exports = {
  createTicket,
  submitTicket,
  updateTicket,
  updateAndSubmitTicket,
  sendToReview,
  rejectTicket,
  returnToCreator,
  markNotified,
  markNotificationError,
  getTicket,
  listTickets,
  listTicketsByUser,
  validateStockAvailability,
  extractStock,
};

async function listTicketsByUser(userId, {page = 1, pageSize = 25} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const snapshot = await db.collection("tickets")
    .where("requestedBy", "==", userId)
    .orderBy("createdAt", "desc")
    .offset((safePage - 1) * safePageSize)
    .limit(safePageSize + 1)
    .get();

  return {
    tickets: snapshot.docs.slice(0, safePageSize).map((doc) => serializeTicketDoc(doc)),
    pagination: {page: safePage, pageSize: safePageSize, hasNext: snapshot.docs.length > safePageSize},
  };
}
