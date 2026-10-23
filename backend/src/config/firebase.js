const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

function normalizePrivateKey(value) {
  let privateKey = String(value || "").trim();
  if ((privateKey.startsWith('"') && privateKey.endsWith('"')) ||
      (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  if (!privateKey.includes("-----BEGIN PRIVATE KEY-----") || !privateKey.includes("-----END PRIVATE KEY-----")) {
    throw new Error("Firebase private key must be a complete PEM value with BEGIN/END PRIVATE KEY markers.");
  }
  return privateKey;
}

// ── Default app (inventory system) ────────────────────────────────────────────
// Used for: auth verification, inventory API token generation, usuarios lookup
function tryInitFromEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID || "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY || "";

  if (!projectId || !clientEmail || !privateKeyRaw) {
    return false;
  }

  const privateKey = normalizePrivateKey(privateKeyRaw);
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  return true;
}

if (!admin.apps.length) {
  const serviceAccountPath = path.resolve(__dirname, "../../service-account.json");
  const hasServiceAccount = fs.existsSync(serviceAccountPath);

  if (hasServiceAccount) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else if (!tryInitFromEnv()) {
    admin.initializeApp();
  } else {
    // initialized via env vars
  }
}

const {FieldValue} = require("firebase-admin/firestore");
const db = admin.firestore();

// ── Ticket app (own database) ────────────────────────────────────────────────
// Used for: tickets, ticketAudits, stockMovements, stockSyncErrors, ubicaciones, config
// Separate Firebase project to decouple from inventory system.
let ticketDb = null;

function initTicketApp() {
  const ticketServiceAccountPath = path.resolve(__dirname, "../../ticket-service-account.json");
  const hasTicketServiceAccount = fs.existsSync(ticketServiceAccountPath);

  // Check env vars first
  const ticketProjectId = process.env.TICKET_FIREBASE_PROJECT_ID || "";
  const ticketClientEmail = process.env.TICKET_FIREBASE_CLIENT_EMAIL || "";
  const ticketPrivateKeyRaw = process.env.TICKET_FIREBASE_PRIVATE_KEY || "";
  const ticketEnvValues = [ticketProjectId, ticketClientEmail, ticketPrivateKeyRaw];
  const hasTicketEnv = ticketEnvValues.some(Boolean);
  const hasCompleteTicketEnv = ticketEnvValues.every(Boolean);

  const TICKET_APP_NAME = "ticketApp";

  // Check if already initialized
  const existing = admin.apps.find((app) => app?.name === TICKET_APP_NAME);
  if (existing) {
    ticketDb = existing.firestore();
    return;
  }

  if (hasTicketEnv && !hasCompleteTicketEnv) {
    throw new Error("Incomplete TicketDatabase credentials. Set TICKET_FIREBASE_PROJECT_ID, TICKET_FIREBASE_CLIENT_EMAIL, and TICKET_FIREBASE_PRIVATE_KEY together.");
  }

  if (hasCompleteTicketEnv) {
    const ticketPrivateKey = normalizePrivateKey(ticketPrivateKeyRaw);
    const ticketApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: ticketProjectId,
        clientEmail: ticketClientEmail,
        privateKey: ticketPrivateKey,
      }),
    }, TICKET_APP_NAME);
    ticketDb = ticketApp.firestore();
    console.log(`[firebase] Ticket app initialized via env vars (project: ${ticketProjectId})`);
  } else if (hasTicketServiceAccount) {
    const ticketServiceAccount = require(ticketServiceAccountPath);
    const ticketApp = admin.initializeApp({
      credential: admin.credential.cert(ticketServiceAccount),
    }, TICKET_APP_NAME);
    ticketDb = ticketApp.firestore();
    console.log(`[firebase] Ticket app initialized via service account (project: ${ticketServiceAccount.project_id})`);
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("TicketDatabase credentials are required in production; refusing to use the inventory database for tickets.");
  } else {
    console.warn("[firebase] No ticket DB configured. Using default DB for all collections. " +
      "Set TICKET_FIREBASE_PROJECT_ID/TICKET_FIREBASE_CLIENT_EMAIL/TICKET_FIREBASE_PRIVATE_KEY " +
      "or add ticket-service-account.json to backend/.");
    ticketDb = db; // fallback to default
  }
}

// Initialize ticket app on module load
initTicketApp();

module.exports = {
  admin,
  db,
  ticketDb,
  FieldValue,
};
