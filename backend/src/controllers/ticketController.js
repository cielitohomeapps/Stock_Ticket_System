const {
  createTicket,
  sendToReview,
  rejectTicket,
  markNotified,
  markNotificationError,
  getTicket,
  listTickets,
  listTicketsByUser,
} = require("../services/ticket.service");
const {applyStockMovementForTicket} = require("../services/stock.service");
const {sendTicketNotification} = require("../services/notification.service");
const {buildApprovedEmail} = require("../services/email.templates");
const {addAuditEntry} = require("../services/audit.service");
const {generatePdf, generateWord} = require("../services/document.service");
const {getEmailConfig} = require("../services/user.service");

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

      return res.status(201).json({ticketId: ticket.id});
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // POST /api/tickets/:id/send-review
  sendToReview: async (req, res) => {
    try {
      await sendToReview(req.params.id, req.user.id, req.authToken);
      await addAuditEntry(req.params.id, "TICKET_SENT_TO_REVIEW", req.user.id);
      return res.json({ok: true, ticketId: req.params.id, status: "EN_REVISION"});
    } catch (error) {
      return res.status(400).json({error: error.message});
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

      if (decision === "REJECT") {
        await rejectTicket(ticketId, req.user.id, comment);
        await addAuditEntry(ticketId, "TICKET_REJECTED", req.user.id, {comment: comment || ""});
        return res.json({ok: true, ticketId, status: "RECHAZADO"});
      }

      await applyStockMovementForTicket(ticketId, req.user.id, req.authToken);
      await addAuditEntry(ticketId, "STOCK_MOVEMENT_APPLIED", req.user.id);

      const ticket = await getTicket(ticketId);
      try {
        await sendTicketNotification({
          to: ticket.assignedUsers || [],
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
          recipients: ticket.assignedUsers || [],
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
          notificationError: notificationError.message,
        });
      }
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // GET /api/tickets/:id
  getById: async (req, res) => {
    try {
      const ticket = await getTicket(req.params.id);
      if (!ticket) {
        return res.status(404).json({error: "Ticket no encontrado"});
      }

      return res.json(ticket);
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // GET /api/tickets/:id/download
  download: async (req, res) => {
    const format = (req.query.format || "pdf").toLowerCase();
    try {
      const ticket = await getTicket(req.params.id);
      if (!ticket) return res.status(404).json({error: "Ticket no encontrado"});

      if (format === "word") {
        const buffer = await generateWord(ticket);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="ticket-${ticket.id}.docx"`);
        return res.send(buffer);
      }

      // default: pdf
      generatePdf(ticket, res);
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // GET /api/my-tickets
  getMyTickets: async (req, res) => {
    try {
      const tickets = await listTicketsByUser(req.user.id);
      return res.json({tickets});
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // GET /api/admin/tickets
  getAll: async (req, res) => {
    try {
      const {status, area} = req.query;
      const tickets = await listTickets({status, area});
      return res.json({tickets});
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // POST /api/admin/tickets/:id/approve
  approve: async (req, res) => {
    const ticketId = req.params.id;
    try {
      // Allow approving from CREADO state by auto-advancing to EN_REVISION first
      const ticket = await getTicket(ticketId);
      if (!ticket) return res.status(404).json({error: "Ticket no encontrado"});
      
      if (ticket.status === "CREADO") {
        try {
          await sendToReview(ticketId, req.user.id, req.authToken);
        } catch (reviewError) {
          console.error(`[approve] Error en sendToReview para ticket ${ticketId}:`, reviewError.message);
          return res.status(400).json({error: `No se pudo enviar a revisión: ${reviewError.message}`});
        }
      }

      try {
        await applyStockMovementForTicket(ticketId, req.user.id, req.authToken);
      } catch (stockError) {
        console.error(`[approve] Error en applyStockMovementForTicket para ticket ${ticketId}:`, stockError.message);
        return res.status(400).json({error: `Error al aplicar movimiento de stock: ${stockError.message}`});
      }
      
      await addAuditEntry(ticketId, "STOCK_MOVEMENT_APPLIED", req.user.id);

      // Re-fetch updated ticket for notification (reuse variable without redeclaring)
      const updatedTicket = await getTicket(ticketId);
      
      let emailConfig = {};
      try {
        emailConfig = await getEmailConfig();
      } catch (emailConfigError) {
        console.error(`[approve] Error obteniendo email config para ticket ${ticketId}:`, emailConfigError.message);
        // Continue without email config — notifications are non-critical
      }
      
      const allRecipients = [
        ...(updatedTicket.assignedUsers || []),
        ...(emailConfig?.recipients || []),
      ].filter(Boolean);

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
        console.error(`[approve] Error en notificación para ticket ${ticketId}:`, notifErr.message);
        await markNotificationError(ticketId, notifErr.message);
      }

      return res.json({ok: true, ticketId, status: "NOTIFICADO"});
    } catch (error) {
      console.error(`[approve] Error inesperado para ticket ${ticketId}:`, error);
      return res.status(400).json({error: error.message});
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
      return res.status(400).json({error: error.message});
    }
  },
};

module.exports = ticketController;