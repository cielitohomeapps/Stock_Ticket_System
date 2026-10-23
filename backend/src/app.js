require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const {admin, db} = require("./config/firebase"); // db = inventory DB (for usuarios lookup)

// Controllers
const ticketController = require("./controllers/ticketController");
const inventoryController = require("./controllers/inventoryController");
const userController = require("./controllers/userController");
const locationController = require("./controllers/locationController");
const reportController = require("./controllers/reportController");
const {monitoringController, checkDatabase} = require("./controllers/monitoringController");

// Middleware
const errorHandler = require("./middleware/errorHandler");
const requestContext = require("./middleware/requestContext");
const {
  securityHeaders,
  noStoreApiResponses,
  createRateLimiter,
} = require("./middleware/security");
const {
  requireBodyAreaAccess,
  requireQueryAreaAccess,
} = require("./services/area-access.service");
const {
  SUPERADMIN_EMAIL,
  requireSuperAdmin,
  requireAdmin,
  requireApprover,
} = require("./middleware/authorization");

const ADMIN_ROLES = ["admin", "superadmin"];

// ── Express app and cross-cutting security controls ──────────────────────────
const app = express();
app.disable("x-powered-by");

const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
const corsOptions = allowedOrigins.length
  ? {origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin))}
  : {origin: process.env.NODE_ENV !== "production"};
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(requestContext);
app.use("/api", noStoreApiResponses);
app.use(express.json({limit: process.env.JSON_BODY_LIMIT || "256kb"}));

const ticketSubmissionRateLimit = createRateLimiter({
  windowMs: Number(process.env.TICKET_SUBMIT_RATE_WINDOW_MS || 60000),
  max: Number(process.env.TICKET_SUBMIT_RATE_MAX || 20),
  scope: "ticket-submit",
});
const privilegedMutationRateLimit = createRateLimiter({
  windowMs: Number(process.env.PRIVILEGED_RATE_WINDOW_MS || 60000),
  max: Number(process.env.PRIVILEGED_RATE_MAX || 60),
  scope: "privileged-mutation",
});
const inventoryReadRateLimit = createRateLimiter({
  windowMs: Number(process.env.INVENTORY_READ_RATE_WINDOW_MS || 60000),
  max: Number(process.env.INVENTORY_READ_RATE_MAX || 120),
  scope: "inventory-read",
});

// ── Metrics middleware ────────────────────────────────────────────────────────
/**
 * Track request latency and status for real-time metrics.
 * Records every request to the metrics store for aggregation.
 */

// Serve static files from the React app build directory
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Ticket Automatization API",
      version: "1.0.0",
      description: "API for ticket management and inventory automation",
    },
    servers: [
      {
        url: "http://localhost:3001",
        description: "Development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ["./src/app.js"], // Path to the API docs
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
if (process.env.NODE_ENV !== "production" || process.env.ENABLE_API_DOCS === "true") {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// ── Auth middleware ──────────────────────────────────────────────────────────

async function requireUser(req, res, next) {
  const authorization = req.header("authorization") || "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1] || "";

  if (!token) {
    return res.status(401).json({error: "Authorization header requerido"});
  }

  if (token.startsWith("dev_token_")) {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_TOKENS !== "true") {
      return res.status(401).json({error: "Dev tokens no habilitados en este entorno"});
    }
    req.user = {id: "dev-user", email: "dev@localhost", role: "admin", areasPermitidas: [], esAdminLevel: true};
    req.authToken = token;
    return next();
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token, true);
    const email = (decoded.email || "").toLowerCase().trim();

    let role = "usuario";
    let areasPermitidas = [];
    let nombre = "";

    if (SUPERADMIN_EMAIL && email === SUPERADMIN_EMAIL) {
      role = "superadmin";
    } else {
      // Read authorization data on every request so role revocations are immediate.
      const userSnap = await db.collection("usuarios")
          .where("email", "==", email)
          .limit(1)
          .get();
      if (userSnap.empty) {
        return res.status(403).json({
          error: "Tu cuenta no está registrada en el sistema. Contacta al administrador para obtener acceso.",
          code: "USER_NOT_REGISTERED",
        });
      }
      const userData = userSnap.docs[0].data();
      role = userData.rol || userData.role || "usuario";
      areasPermitidas = Array.isArray(userData.areasPermitidas) ? userData.areasPermitidas : [];
      nombre = userData.nombre || "";
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



/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 service:
 *                   type: string
 */
app.get("/api/health", (_req, res) => {
  res.json({ok: true, service: "ticket-automation-backend"});
});
app.get("/api/health/live", (_req, res) => {
  res.json({ok: true, status: "UP"});
});
app.get("/api/health/ready", async (_req, res) => {
  const database = await checkDatabase();
  const ok = database.status === "UP";
  res.status(ok ? 200 : 503).json({ok, status: ok ? "READY" : "NOT_READY"});
});

/**
 * @swagger
 * /api/inventory/products/{id}:
 *   get:
 *     summary: Get product by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product data
 *       400:
 *         description: Error
 */
app.get("/api/inventory/products/:id", requireUser, inventoryReadRateLimit, inventoryController.getProduct);

/**
 * @swagger
 * /api/inventory/products:
 *   get:
 *     summary: Get products by area
 *     parameters:
 *       - in: query
 *         name: area
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of products
 *       400:
 *         description: Error
 */
app.get("/api/inventory/products", requireUser, inventoryReadRateLimit, requireQueryAreaAccess, inventoryController.getProducts);

/**
 * @swagger
 * /api/inventory/areas:
 *   get:
 *     summary: Get available areas
 *     responses:
 *       200:
 *         description: List of areas
 *       400:
 *         description: Error
 */
app.get("/api/inventory/areas", requireUser, inventoryReadRateLimit, inventoryController.getAreas);

/**
 * @swagger
 * /api/tickets/{id}/download:
 *   get:
 *     summary: Download ticket document
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [pdf, word]
 *     responses:
 *       200:
 *         description: Document file
 *       404:
 *         description: Ticket not found
 */
app.get("/api/tickets/:id/download", requireUser, ticketController.download);

/**
 * @swagger
 * /api/tickets:
 *   post:
 *     summary: Create a new ticket
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [ENTRY, EXIT]
 *               items:
 *                 type: array
 *               assignedUsers:
 *                 type: array
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Ticket created
 *       400:
 *         description: Validation error
 */
app.post("/api/tickets", requireUser, ticketSubmissionRateLimit, requireBodyAreaAccess, ticketController.create);
app.post("/api/tickets/submit", requireUser, ticketSubmissionRateLimit, requireBodyAreaAccess, ticketController.submit);
app.put("/api/tickets/:id", requireUser, ticketSubmissionRateLimit, requireBodyAreaAccess, ticketController.update);
app.put("/api/tickets/:id/submit", requireUser, ticketSubmissionRateLimit, requireBodyAreaAccess, ticketController.updateAndSubmit);

app.post("/api/tickets/:id/send-review", requireUser, ticketSubmissionRateLimit, ticketController.sendToReview);

app.post("/api/tickets/:id/review", requireUser, requireApprover, privilegedMutationRateLimit, ticketController.review);

app.get("/api/tickets/:id", requireUser, ticketController.getById);

// ── /api/my-tickets ───────────────────────────────────────────────────────────
app.get("/api/my-tickets", requireUser, ticketController.getMyTickets);

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
/**
 * @swagger
 * /api/admin/tickets:
 *   get:
 *     summary: Get all tickets (admin)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: area
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of tickets
 *       403:
 *         description: Admin access required
 */
app.get("/api/admin/tickets", requireUser, requireAdmin, ticketController.getAll);

app.post("/api/admin/tickets/:id/approve", requireUser, requireAdmin, privilegedMutationRateLimit, ticketController.approve);

app.post("/api/admin/tickets/:id/reject", requireUser, requireAdmin, privilegedMutationRateLimit, ticketController.reject);

app.post("/api/admin/tickets/:id/return", requireUser, requireAdmin, privilegedMutationRateLimit, ticketController.returnToCreator);
app.post("/api/admin/tickets/:id/reconcile-stock", requireUser, requireAdmin, privilegedMutationRateLimit, ticketController.reconcileStock);

// ── Admin: users ──────────────────────────────────────────────────────────────
app.get("/api/admin/users", requireUser, requireAdmin, userController.list);
app.post("/api/admin/users", requireUser, requireAdmin, privilegedMutationRateLimit, userController.create);
app.patch("/api/admin/users/:uid", requireUser, requireAdmin, privilegedMutationRateLimit, userController.update);
app.delete("/api/admin/users/:uid", requireUser, requireAdmin, privilegedMutationRateLimit, userController.delete);

// ── Admin: email config ───────────────────────────────────────────────────────
app.get("/api/admin/email-config", requireUser, requireAdmin, userController.getEmailConfig);
app.put("/api/admin/email-config", requireUser, requireSuperAdmin, privilegedMutationRateLimit, userController.updateEmailConfig);

// ── Locations: canonical catalog and reports ───────────────────────────────────
app.get("/api/locations", requireUser, locationController.list);
app.post("/api/locations", requireUser, requireAdmin, privilegedMutationRateLimit, locationController.create);
app.patch("/api/locations/:id", requireUser, requireAdmin, privilegedMutationRateLimit, locationController.update);
app.post("/api/locations/:id/merge", requireUser, requireAdmin, privilegedMutationRateLimit, locationController.merge);
app.delete("/api/locations/:id", requireUser, requireAdmin, privilegedMutationRateLimit, locationController.delete);
app.get("/api/reports/locations", requireUser, requireAdmin, locationController.reportByLocation);
app.get("/api/reports/destinos", requireUser, requireAdmin, locationController.reportByLocation);
app.get("/api/reports/executive", requireUser, requireAdmin, reportController.getExecutiveReport);
app.get("/api/admin/analytics/tickets", requireUser, requireAdmin, reportController.getAnalyticsTickets);

// ── Metrics endpoints ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/metrics/snapshot:
 *   get:
 *     summary: Get current metrics snapshot (polling fallback)
 *     responses:
 *       200:
 *         description: Current metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 metrics:
 *                   type: object
 *                 logs:
 *                   type: array
 */
app.get("/api/metrics/snapshot", requireUser, requireAdmin, monitoringController.summary);
app.get("/api/admin/monitoring/summary", requireUser, requireAdmin, monitoringController.summary);
app.get("/api/admin/monitoring/logs", requireUser, requireAdmin, monitoringController.logs);
app.get("/api/admin/monitoring/alerts", requireUser, requireAdmin, monitoringController.alerts);
app.get("/api/admin/monitoring/integrity", requireUser, requireAdmin, monitoringController.integrity);
app.get("/api/admin/health", requireUser, requireAdmin, monitoringController.detailedHealth);

app.use("/api", (req, res) => {
  res.status(404).json({error: "Endpoint no encontrado", requestId: req.id});
});

// Catch all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

// ── Global error handler (must be last) ────────────────────────────────────
app.use(errorHandler);

module.exports = {
  app,
};
