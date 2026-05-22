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

// Services
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

// Catch all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

module.exports = {
  app,
};
