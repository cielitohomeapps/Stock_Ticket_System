require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const {admin, db} = require("./config/firebase");

// Controllers
const ticketController = require("./controllers/ticketController");
const inventoryController = require("./controllers/inventoryController");
const userController = require("./controllers/userController");
const locationController = require("./controllers/locationController");
const reportController = require("./controllers/reportController");

// Middleware
const errorHandler = require("./middleware/errorHandler");
const {
  SUPERADMIN_EMAIL,
  requireSuperAdmin,
  requireAdmin,
  requireApprover,
} = require("./middleware/authorization");

const ADMIN_ROLES = ["admin", "superadmin"];

const {metricsStore} = require("./services/metrics.service");

const app = express();

app.use(cors({origin: true}));
app.use(express.json());

// ── Metrics middleware ────────────────────────────────────────────────────────
/**
 * Track request latency and status for real-time metrics.
 * Records every request to the metrics store for aggregation.
 */
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const userId = req.user?.id || null;
    metricsStore.recordRequest(res.statusCode, durationMs, userId);
  });
  
  next();
});

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
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── Auth middleware ──────────────────────────────────────────────────────────

async function requireUser(req, res, next) {
  const authorization = req.header("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

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
app.get("/api/inventory/products/:id", requireUser, inventoryController.getProduct);

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
app.get("/api/inventory/products", requireUser, inventoryController.getProducts);

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
app.get("/api/inventory/areas", requireUser, inventoryController.getAreas);

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
app.post("/api/tickets", requireUser, ticketController.create);
app.put("/api/tickets/:id", requireUser, ticketController.update);

app.post("/api/tickets/:id/send-review", requireUser, ticketController.sendToReview);

app.post("/api/tickets/:id/review", requireUser, requireApprover, ticketController.review);

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

app.post("/api/admin/tickets/:id/approve", requireUser, requireAdmin, ticketController.approve);

app.post("/api/admin/tickets/:id/reject", requireUser, requireAdmin, ticketController.reject);

// ── Admin: users ──────────────────────────────────────────────────────────────
app.get("/api/admin/users", requireUser, requireAdmin, userController.list);
app.post("/api/admin/users", requireUser, requireAdmin, userController.create);
app.patch("/api/admin/users/:uid", requireUser, requireAdmin, userController.update);
app.delete("/api/admin/users/:uid", requireUser, requireAdmin, userController.delete);

// ── Admin: email config ───────────────────────────────────────────────────────
app.get("/api/admin/email-config", requireUser, requireAdmin, userController.getEmailConfig);
app.put("/api/admin/email-config", requireUser, requireSuperAdmin, userController.updateEmailConfig);

// ── Locations: canonical catalog and reports ───────────────────────────────────
app.get("/api/locations", requireUser, locationController.list);
app.post("/api/locations", requireUser, requireAdmin, locationController.create);
app.patch("/api/locations/:id", requireUser, requireAdmin, locationController.update);
app.delete("/api/locations/:id", requireUser, requireAdmin, locationController.delete);
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
app.get("/api/metrics/snapshot", requireUser, (req, res) => {
  res.json({
    metrics: metricsStore.getSnapshot(),
    logs: metricsStore.getRecentEvents(50),
  });
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
