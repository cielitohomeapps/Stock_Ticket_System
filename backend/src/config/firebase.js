const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

function tryInitFromEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID || "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY || "";

  if (!projectId || !clientEmail || !privateKeyRaw) {
    return false;
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
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

module.exports = {
  admin,
  db,
  FieldValue,
};
