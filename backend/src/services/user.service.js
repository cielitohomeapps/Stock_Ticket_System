const {db, ticketDb, FieldValue} = require("../config/firebase");
const {normalizeEmailAddresses, normalizeOptionalText} = require("./input-validation.service");

// usuarios collection: stays on inventory DB (shared with inventory system)
const USUARIOS_DB = db;
// config collection: moves to ticket DB (ticket-specific settings)
const CONFIG_DB = ticketDb;

const COLLECTION = "usuarios";
const VALID_ROLES = ["superadmin", "admin", "jefe_area", "usuario"];

function normalizeAreas(values) {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw new Error("areasPermitidas debe ser una lista.");
  if (values.length > 100) throw new Error("areasPermitidas no puede contener más de 100 áreas.");
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function serializeUserDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    email: data.email || "",
    rol: data.rol || data.role || "usuario",
    areasPermitidas: Array.isArray(data.areasPermitidas) ? data.areasPermitidas : [],
    nombre: data.nombre || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

async function listUsers() {
  const snap = await USUARIOS_DB.collection(COLLECTION).orderBy("email").get();
  return snap.docs.map(serializeUserDoc);
}

async function getUserByEmail(email) {
  const snap = await USUARIOS_DB.collection(COLLECTION)
      .where("email", "==", email)
      .limit(1)
      .get();
  if (snap.empty) return null;
  return serializeUserDoc(snap.docs[0]);
}

async function getUserById(uid) {
  const snap = await USUARIOS_DB.collection(COLLECTION).doc(uid).get();
  if (!snap.exists) return null;
  return serializeUserDoc(snap);
}

async function createUser({email, rol, areasPermitidas, nombre}) {
  const normalizedEmail = normalizeEmailAddresses([email], {field: "email", max: 1})[0];
  const normalizedAreas = normalizeAreas(areasPermitidas) || [];
  const normalizedName = normalizeOptionalText(nombre, {field: "nombre", max: 200});
  if (rol && !VALID_ROLES.includes(rol)) {
    throw new Error(`Rol inválido. Roles válidos: ${VALID_ROLES.join(", ")}`);
  }

  const existing = await USUARIOS_DB.collection(COLLECTION)
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();
  if (!existing.empty) {
    throw new Error("Ya existe un usuario con ese email.");
  }

  const ref = USUARIOS_DB.collection(COLLECTION).doc();
  await ref.set({
    email: normalizedEmail,
    rol: rol || "usuario",
    areasPermitidas: normalizedAreas,
    nombre: normalizedName,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {id: ref.id};
}

async function updateUser(uid, {rol, areasPermitidas, nombre}) {
  if (rol !== undefined && !VALID_ROLES.includes(rol)) {
    throw new Error(`Rol inválido. Roles válidos: ${VALID_ROLES.join(", ")}`);
  }

  const ref = USUARIOS_DB.collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Usuario no encontrado.");

  const updates = {updatedAt: FieldValue.serverTimestamp()};
  if (rol !== undefined) updates.rol = rol;
  if (areasPermitidas !== undefined) {
    updates.areasPermitidas = normalizeAreas(areasPermitidas);
  }
  if (nombre !== undefined) updates.nombre = normalizeOptionalText(nombre, {field: "nombre", max: 200});

  await ref.update(updates);
  return {id: uid};
}

async function deleteUser(uid) {
  const ref = USUARIOS_DB.collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Usuario no encontrado.");
  await ref.delete();
}

async function getEmailConfig() {
  try {
    const snap = await CONFIG_DB.collection("config").doc("emails").get();
    if (!snap.exists) {
      console.log("[getEmailConfig] Config doc does not exist, returning defaults");
      return {recipients: [], ccRecipients: [], fromName: "Cielito Home"};
    }
    const data = snap.data() || {};
    return {
      recipients: normalizeEmailAddresses(data.recipients, {field: "recipients", max: 50}),
      ccRecipients: normalizeEmailAddresses(data.ccRecipients, {field: "ccRecipients", max: 50}),
      fromName: normalizeOptionalText(data.fromName || "Cielito Home", {field: "fromName", max: 100}),
    };
  } catch (err) {
    console.error("[getEmailConfig] Error fetching from Firestore:", err.message);
    return {recipients: [], ccRecipients: [], fromName: "Cielito Home"};
  }
}

async function saveEmailConfig({recipients, ccRecipients, fromName}) {
  const safeRecipients = normalizeEmailAddresses(recipients, {field: "recipients", max: 50});
  const safeCcRecipients = normalizeEmailAddresses(ccRecipients, {field: "ccRecipients", max: 50});
  const safeFromName = normalizeOptionalText(fromName || "Cielito Home", {field: "fromName", max: 100});
  await CONFIG_DB.collection("config").doc("emails").set(
      {
        recipients: safeRecipients,
        ccRecipients: safeCcRecipients,
        fromName: safeFromName,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
  );
}

module.exports = {
  listUsers,
  getUserByEmail,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getEmailConfig,
  saveEmailConfig,
};
