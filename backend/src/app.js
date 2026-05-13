require("dotenv").config();

const express = require("express");
const cors = require("cors");
const {admin, db} = require("./config/firebase");
const {
  createTicket,
  sendToReview,
  rejectTicket,
  markNotified,
  markNotificationError,
  getTicket,
  listTickets,
  listTicketsByUser,
} = require("./services/ticket.service");
const {applyStockMovementForTicket} = require("./services/stock.service");
const {sendTicketNotification} = require("./services/notification.service");
const {buildApprovedEmail} = require("./services/email.templates");
const {addAuditEntry} = require("./services/audit.service");
const {
  getProductById,
  getProductsByArea,
  getAvailableAreas,
} = require("./services/inventory-api.service");
const {generatePdf, generateWord} = require("./services/document.service");
const {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getEmailConfig,
  saveEmailConfig,
} = require("./services/user.service");

const SUPERADMIN_EMAIL = "sistemasch17@gmail.com";
const ADMIN_ROLES = ["admin", "superadmin"];

const app = express();

app.use(cors({origin: true}));
app.use(express.json());

// ── Auth middleware ──────────────────────────────────────────────────────────

async function requireUser(req, res, next) {
  const authorization = req.header("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return res.status(401).json({error: "Authorization header requerido"});
  }

  if (token.startsWith("dev_token_")) {
    if (process.env.NODE_ENV === "production") {
      return res.status(401).json({error: "Dev tokens no permitidos en producción"});
    }
    req.user = {id: "dev-user", email: "dev@localhost", role: "admin", areasPermitidas: [], esAdminLevel: true};
    req.authToken = token;
    return next();
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const email = (decoded.email || "").toLowerCase().trim();

    let role = "usuario";
    let areasPermitidas = [];
    let nombre = "";

    if (email === SUPERADMIN_EMAIL) {
      role = "superadmin";
    } else {
      // Look up user in Firestore usuarios collection
      const userSnap = await db.collection("usuarios")
          .where("email", "==", email)
          .limit(1)
          .get();
      if (!userSnap.empty) {
        const userData = userSnap.docs[0].data();
        role = userData.rol || userData.role || "usuario";
        areasPermitidas = Array.isArray(userData.areasPermitidas) ? userData.areasPermitidas : [];
        nombre = userData.nombre || "";
      }
    }

    req.user = {
      id: decoded.uid,
      email,
      nombre,
      role,
      areasPermitidas,
      esAdminLevel: ADMIN_ROLES.includes(role),
    };
    req.authToken = token;
    return next();
  } catch (err) {
    return res.status(401).json({error: "Token inválido o expirado"});
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.esAdminLevel) {
    return res.status(403).json({error: "Se requiere rol de administrador"});
  }
  return next();
}

function requireApprover(req, res, next) {
  if (!req.user?.esAdminLevel) {
    return res.status(403).json({error: "Tu rol no puede aprobar/rechazar tickets"});
  }
  return next();
}

app.get("/api/health", (_req, res) => {
  res.json({ok: true, service: "ticket-automation-backend"});
});

app.get("/api/inventory/products/:id", requireUser, async (req, res) => {
  try {
    const data = await getProductById(req.params.id, req.authToken);
    return res.json(data);
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.get("/api/inventory/products", requireUser, async (req, res) => {
  try {
    const data = await getProductsByArea(req.query.area, req.authToken);
    return res.json(data);
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.get("/api/inventory/areas", requireUser, async (_req, res) => {
  try {
    const areas = await getAvailableAreas(_req.authToken);
    return res.json({areas});
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.get("/api/tickets/:id/download", requireUser, async (req, res) => {
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
});

app.post("/api/tickets", requireUser, async (req, res) => {
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
});

app.post("/api/tickets/:id/send-review", requireUser, async (req, res) => {
  try {
    await sendToReview(req.params.id, req.user.id);
    await addAuditEntry(req.params.id, "TICKET_SENT_TO_REVIEW", req.user.id);
    return res.json({ok: true, ticketId: req.params.id, status: "EN_REVISION"});
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.post("/api/tickets/:id/review", requireUser, requireApprover, async (req, res) => {
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
});

app.get("/api/tickets/:id", requireUser, async (req, res) => {
  try {
    const ticket = await getTicket(req.params.id);
    if (!ticket) {
      return res.status(404).json({error: "Ticket no encontrado"});
    }

    return res.json(ticket);
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

// ── /api/my-tickets ───────────────────────────────────────────────────────────
app.get("/api/my-tickets", requireUser, async (req, res) => {
  try {
    const tickets = await listTicketsByUser(req.user.id);
    return res.json({tickets});
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

// ── /api/me ───────────────────────────────────────────────────────────────────
app.get("/api/me", requireUser, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    nombre: req.user.nombre,
    role: req.user.role,
    areasPermitidas: req.user.areasPermitidas,
    esAdminLevel: req.user.esAdminLevel,
  });
});

// ── Admin: tickets ────────────────────────────────────────────────────────────
app.get("/api/admin/tickets", requireUser, requireAdmin, async (req, res) => {
  try {
    const {status, area} = req.query;
    const tickets = await listTickets({status, area});
    return res.json({tickets});
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.post("/api/admin/tickets/:id/approve", requireUser, requireAdmin, async (req, res) => {
  const ticketId = req.params.id;
  try {
    // Allow approving from CREADO state by auto-advancing to EN_REVISION first
    const ticket = await getTicket(ticketId);
    if (!ticket) return res.status(404).json({error: "Ticket no encontrado"});
    if (ticket.status === "CREADO") {
      await sendToReview(ticketId, req.user.id);
    }

    await applyStockMovementForTicket(ticketId, req.user.id, req.authToken);
    await addAuditEntry(ticketId, "STOCK_MOVEMENT_APPLIED", req.user.id);

    // Re-fetch updated ticket for notification (reuse variable without redeclaring)
    const updatedTicket = await getTicket(ticketId);
    const emailConfig = await getEmailConfig();
    const allRecipients = [
      ...(updatedTicket.assignedUsers || []),
      ...(emailConfig.recipients || []),
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
      await markNotificationError(ticketId, notifErr.message);
    }

    return res.json({ok: true, ticketId, status: "NOTIFICADO"});
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.post("/api/admin/tickets/:id/reject", requireUser, requireAdmin, async (req, res) => {
  const ticketId = req.params.id;
  const {comment} = req.body;
  try {
    await rejectTicket(ticketId, req.user.id, comment);
    await addAuditEntry(ticketId, "TICKET_REJECTED", req.user.id, {comment: comment || ""});
    return res.json({ok: true, ticketId, status: "RECHAZADO"});
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

// ── Admin: users ──────────────────────────────────────────────────────────────
app.get("/api/admin/users", requireUser, requireAdmin, async (_req, res) => {
  try {
    const users = await listUsers();
    return res.json({users});
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.post("/api/admin/users", requireUser, requireAdmin, async (req, res) => {
  try {
    const {email, rol, areasPermitidas, nombre} = req.body;
    const result = await createUser({email, rol, areasPermitidas, nombre});
    await addAuditEntry("users", "USER_CREATED", req.user.id, {email, rol});
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.patch("/api/admin/users/:uid", requireUser, requireAdmin, async (req, res) => {
  try {
    const {rol, areasPermitidas, nombre} = req.body;
    const result = await updateUser(req.params.uid, {rol, areasPermitidas, nombre});
    await addAuditEntry("users", "USER_UPDATED", req.user.id, {uid: req.params.uid, rol});
    return res.json(result);
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.delete("/api/admin/users/:uid", requireUser, requireAdmin, async (req, res) => {
  try {
    await deleteUser(req.params.uid);
    await addAuditEntry("users", "USER_DELETED", req.user.id, {uid: req.params.uid});
    return res.json({ok: true});
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

// ── Admin: email config ───────────────────────────────────────────────────────
app.get("/api/admin/email-config", requireUser, requireAdmin, async (_req, res) => {
  try {
    const config = await getEmailConfig();
    return res.json(config);
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

app.put("/api/admin/email-config", requireUser, requireAdmin, async (req, res) => {
  try {
    const {recipients, ccRecipients, fromName} = req.body;
    await saveEmailConfig({recipients, ccRecipients, fromName});
    return res.json({ok: true});
  } catch (error) {
    return res.status(400).json({error: error.message});
  }
});

module.exports = {
  app,
};
