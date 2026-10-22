const {
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
} = require("../services/ticket.service");
const {
  applyStockMovementForTicket,
  reconcileUnknownStockMovement,
} = require("../services/stock.service");
const {sendTicketNotification} = require("../services/notification.service");
const {buildApprovedEmail} = require("../services/email.templates");
const {addAuditEntry} = require("../services/audit.service");
const {generatePdf, generateWord} = require("../services/document.service");
const {getEmailConfig} = require("../services/user.service");
const {canAccessTicket} = require("../services/ticket-integrity.service");
const {logger} = require("../services/observability.service");

function respondError(req, res, error, fallbackStatus = 500) {
  const suppliedStatus = Number(error.statusCode);
  const statusCode = Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus < 600
    ? suppliedStatus
    : fallbackStatus;
  const context = {
    eventType: "TICKET_OPERATION_FAILED",
    module: "tickets",
    requestId: req.id,
    correlationId: req.correlationId,
    ticketId: req.params?.id || null,
    errorType: error.code || error.name,
  };
  if (statusCode >= 500) logger.error("Fallo en operacion de ticket", context, error);
  else logger.warn("Operacion de ticket rechazada", context, error);
  const body = {
    error: statusCode >= 500 && process.env.NODE_ENV === "production"
      ? "No se pudo completar la operación. Inténtalo más tarde o contacta al administrador."
      : error.message || "No se pudo completar la operación.",
    code: error.code || (statusCode >= 500 ? "INTERNAL_ERROR" : "TICKET_OPERATION_FAILED"),
    requestId: req.id,
  };
  if (Array.isArray(error.details) && statusCode < 500) body.details = error.details;
  if (error.ticketId) body.ticketId = error.ticketId;
  return res.status(statusCode).json(body);
}

const ticketController = {
  // POST /api/tickets
  create: async (req, res) => {
    try {
      const {type, items, assignedUsers, metadata} = req.body;
      const ticket = await createTicket({
        type,
        items,
        assignedUsers,
        metadata,
        requestedBy: req.user.id,
      });

      await addAuditEntry(ticket.id, "TICKET_CREATED", req.user.id, {
        type,
        itemsCount: items?.length || 0,
      });

      return res.status(201).json({ticketId: ticket.id, status: ticket.status});
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // POST /api/tickets/submit - validates and persists an already submitted ticket atomically.
  submit: async (req, res) => {
    try {
      const ticket = await submitTicket({
        ...req.body,
        requestedBy: req.user.id,
      }, req.authToken, req.get("Idempotency-Key"));
      if (!ticket.replayed) {
        await addAuditEntry(ticket.id, "TICKET_SUBMITTED", req.user.id, {
          type: req.body.type,
          itemsCount: req.body.items?.length || 0,
          requestId: req.id,
          correlationId: req.correlationId,
        });
      }
      return res.status(201).json({ticketId: ticket.id, status: ticket.status, requestId: req.id});
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  reconcileStock: async (req, res) => {
    try {
      const result = await reconcileUnknownStockMovement(
          req.params.id,
          req.user.id,
          req.body,
      );
      return res.json({ok: true, ...result, requestId: req.id});
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // PUT /api/tickets/:id
  update: async (req, res) => {
    try {
      const {type, items, assignedUsers, metadata} = req.body;
      await updateTicket(req.params.id, req.user.id, {
        type,
        items,
        assignedUsers,
        metadata
      });

      await addAuditEntry(req.params.id, "TICKET_UPDATED", req.user.id, {
        type,
        itemsCount: items?.length || 0,
      });

      return res.json({ok: true, ticketId: req.params.id, status: "CREADO"});
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // PUT /api/tickets/:id/submit
  updateAndSubmit: async (req, res) => {
    try {
      const ticket = await updateAndSubmitTicket(req.params.id, req.user.id, req.body, req.authToken);
      await addAuditEntry(ticket.id, "TICKET_UPDATED_AND_SUBMITTED", req.user.id, {
        type: req.body.type,
        itemsCount: req.body.items?.length || 0,
        requestId: req.id,
        correlationId: req.correlationId,
      });
      return res.json({ok: true, ticketId: ticket.id, status: ticket.status, requestId: req.id});
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // POST /api/tickets/:id/send-review
  sendToReview: async (req, res) => {
    try {
      await sendToReview(req.params.id, req.user.id, req.authToken);
      await addAuditEntry(req.params.id, "TICKET_SENT_TO_REVIEW", req.user.id);
      return res.json({ok: true, ticketId: req.params.id, status: "EN_REVISION"});
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // POST /api/tickets/:id/review
  review: async (req, res) => {
    const ticketId = req.params.id;
    const {decision, comment} = req.body;

    try {
      if (!["APPROVE", "REJECT"].includes(decision)) {
        return res.status(400).json({error: "decision debe ser APPROVE o REJECT"});
      }

      const currentTicket = await getTicket(ticketId);
      if (!currentTicket) {
        return res.status(404).json({error: "Ticket no encontrado"});
      }

      if (decision === "REJECT") {
        await rejectTicket(ticketId, req.user.id, comment);
        await addAuditEntry(ticketId, "TICKET_REJECTED", req.user.id, {comment: comment || ""});
        return res.json({ok: true, ticketId, status: "RECHAZADO"});
      }

      if (currentTicket.status !== "EN_REVISION") {
        return res.status(409).json({
          error: "Solo se puede aprobar un ticket enviado a revision.",
          code: "INVALID_TICKET_STATE",
          requestId: req.id,
        });
      }

      await applyStockMovementForTicket(ticketId, req.user.id, req.authToken);
      await addAuditEntry(ticketId, "STOCK_MOVEMENT_APPLIED", req.user.id);

      const ticket = await getTicket(ticketId);
      let emailConfig = {};
      try {
        emailConfig = await getEmailConfig();
      } catch (emailConfigError) {
        logger.warn("No se pudo obtener la configuracion de correo", {eventType: "EMAIL_CONFIG_FAILED", module: "notifications", requestId: req.id, correlationId: req.correlationId, ticketId}, emailConfigError);
      }
      const recipients = [
        ...(ticket.assignedUsers || []),
        ...(emailConfig?.recipients || []),
      ].filter(Boolean);
      if (recipients.length === 0) {
        return res.json({ok: true, ticketId, status: "STOCK_ACTUALIZADO", notification: "SKIPPED_NO_RECIPIENTS"});
      }
      try {
        await sendTicketNotification({
          to: recipients,
          subject: `Ticket ${ticketId} aprobado y stock actualizado`,
          html: buildApprovedEmail({
            ticketId,
            type: ticket.type,
            area: ticket.metadata?.area,
            approvedBy: req.user.email || req.user.id,
            items: ticket.items,
            status: "Stock actualizado",
          }),
        });

        await markNotified(ticketId);
        await addAuditEntry(ticketId, "TICKET_NOTIFIED", req.user.id, {
          recipientCount: recipients.length,
        });

        return res.json({ok: true, ticketId, status: "NOTIFICADO"});
      } catch (notificationError) {
        await markNotificationError(ticketId, notificationError.message);
        await addAuditEntry(ticketId, "NOTIFICATION_ERROR", req.user.id, {
          error: notificationError.message,
        });

        return res.status(207).json({
          ok: false,
          ticketId,
          status: "STOCK_ACTUALIZADO",
          warning: "Stock actualizado, pero fallo el envio de correo",
          requestId: req.id,
        });
      }
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // GET /api/tickets/:id
  getById: async (req, res) => {
    try {
      const ticket = await getTicket(req.params.id);
      if (!ticket) {
        return res.status(404).json({error: "Ticket no encontrado"});
      }
      if (!canAccessTicket(ticket, req.user)) {
        return res.status(403).json({error: "No tienes permiso para consultar este ticket", requestId: req.id});
      }

      return res.json(ticket);
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // GET /api/tickets/:id/download
  download: async (req, res) => {
    const format = (req.query.format || "pdf").toLowerCase();
    try {
      const ticket = await getTicket(req.params.id);
      if (!ticket) return res.status(404).json({error: "Ticket no encontrado"});
      if (!canAccessTicket(ticket, req.user)) {
        return res.status(403).json({error: "No tienes permiso para descargar este ticket", requestId: req.id});
      }

      if (format === "word") {
        const buffer = await generateWord(ticket);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="ticket-${ticket.id}.docx"`);
        return res.send(buffer);
      }

      // default: pdf
      generatePdf(ticket, res);
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // GET /api/my-tickets
  getMyTickets: async (req, res) => {
    try {
      const result = await listTicketsByUser(req.user.id, req.query);
      return res.json(result);
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // GET /api/admin/tickets
  getAll: async (req, res) => {
    try {
      const result = await listTickets(req.query);
      return res.json(result);
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // POST /api/admin/tickets/:id/approve
  approve: async (req, res) => {
    const ticketId = req.params.id;
    try {
      // Allow approving from CREADO state by auto-advancing to EN_REVISION first
      const ticket = await getTicket(ticketId);
      if (!ticket) return res.status(404).json({error: "Ticket no encontrado"});
      if (ticket.status !== "EN_REVISION") {
        return res.status(409).json({
          error: "Solo se puede aprobar un ticket enviado a revision.",
          code: "INVALID_TICKET_STATE",
          requestId: req.id,
        });
      }

      try {
        await applyStockMovementForTicket(ticketId, req.user.id, req.authToken);
      } catch (stockError) {
        logger.error("Fallo la aplicacion del movimiento de stock", {eventType: "STOCK_MOVEMENT_FAILED", module: "inventory", requestId: req.id, correlationId: req.correlationId, ticketId}, stockError);
        return respondError(req, res, stockError, 500);
      }
      
      await addAuditEntry(ticketId, "STOCK_MOVEMENT_APPLIED", req.user.id);

      // Re-fetch updated ticket for notification (reuse variable without redeclaring)
      const updatedTicket = await getTicket(ticketId);
      
      let emailConfig = {};
      try {
        emailConfig = await getEmailConfig();
      } catch (emailConfigError) {
        logger.warn("No se pudo obtener la configuracion de correo", {eventType: "EMAIL_CONFIG_FAILED", module: "notifications", requestId: req.id, correlationId: req.correlationId, ticketId}, emailConfigError);
        // Continue without email config — notifications are non-critical
      }
      
      const allRecipients = [
        ...(updatedTicket.assignedUsers || []),
        ...(emailConfig?.recipients || []),
      ].filter(Boolean);

      let notificationFailed = false;
      try {
        if (allRecipients.length > 0) {
          await sendTicketNotification({
            to: allRecipients,
            subject: `Ticket ${ticketId} aprobado`,
            html: buildApprovedEmail({
              ticketId,
              type: updatedTicket.type,
              area: updatedTicket.metadata?.area,
              approvedBy: req.user.email,
              items: updatedTicket.items,
            }),
          });
          await markNotified(ticketId);
          await addAuditEntry(ticketId, "TICKET_NOTIFIED", req.user.id, {recipients: allRecipients});
        }
      } catch (notifErr) {
        logger.warn("Fallo la notificacion de un ticket aprobado", {eventType: "NOTIFICATION_ERROR", module: "notifications", requestId: req.id, correlationId: req.correlationId, ticketId}, notifErr);
        await markNotificationError(ticketId, notifErr.message);
        notificationFailed = true;
      }

      if (notificationFailed) {
        return res.status(207).json({
          ok: false,
          ticketId,
          status: "STOCK_ACTUALIZADO",
          warning: "El stock se actualizo, pero la notificacion fallo.",
          requestId: req.id,
        });
      }
      const finalStatus = allRecipients.length > 0
        ? "NOTIFICADO"
        : "STOCK_ACTUALIZADO";
      return res.json({ok: true, ticketId, status: finalStatus});
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // POST /api/admin/tickets/:id/reject
  reject: async (req, res) => {
    const ticketId = req.params.id;
    const {comment} = req.body;
    try {
      await rejectTicket(ticketId, req.user.id, comment);
      await addAuditEntry(ticketId, "TICKET_REJECTED", req.user.id, {comment: comment || ""});
      return res.json({ok: true, ticketId, status: "RECHAZADO"});
    } catch (error) {
      return respondError(req, res, error);
    }
  },

  // POST /api/admin/tickets/:id/return
  returnToCreator: async (req, res) => {
    const ticketId = req.params.id;
    const {comment} = req.body;
    try {
      await returnToCreator(ticketId, req.user.id, comment);
      await addAuditEntry(ticketId, "TICKET_RETURNED_TO_CREATOR", req.user.id, {comment: comment || ""});
      return res.json({ok: true, ticketId, status: "PENDIENTE_CORRECCION"});
    } catch (error) {
      return respondError(req, res, error);
    }
  },
};

module.exports = ticketController;
