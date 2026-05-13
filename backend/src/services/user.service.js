const {db, FieldValue} = require("../config/firebase");

const COLLECTION = "usuarios";
const VALID_ROLES = ["superadmin", "admin", "jefe_area", "usuario"];

async function listUsers() {
  const snap = await db.collection(COLLECTION).orderBy("email").get();
  return snap.docs.map((d) => ({id: d.id, ...d.data()}));
}

async function getUserByEmail(email) {
  const snap = await db.collection(COLLECTION)
      .where("email", "==", email)
      .limit(1)
      .get();
  if (snap.empty) return null;
  return {id: snap.docs[0].id, ...snap.docs[0].data()};
}

async function createUser({email, rol, areasPermitidas, nombre}) {
  if (!email || !email.includes("@")) {
    throw new Error("Email inválido.");
  }
  if (rol && !VALID_ROLES.includes(rol)) {
    throw new Error(`Rol inválido. Roles válidos: ${VALID_ROLES.join(", ")}`);
  }

  const existing = await db.collection(COLLECTION)
      .where("email", "==", email.toLowerCase().trim())
      .limit(1)
      .get();
  if (!existing.empty) {
    throw new Error("Ya existe un usuario con ese email.");
  }

  const ref = db.collection(COLLECTION).doc();
  await ref.set({
    email: email.toLowerCase().trim(),
    rol: rol || "usuario",
    areasPermitidas: Array.isArray(areasPermitidas) ? areasPermitidas : [],
    nombre: nombre || "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {id: ref.id};
}

async function updateUser(uid, {rol, areasPermitidas, nombre}) {
  if (rol !== undefined && !VALID_ROLES.includes(rol)) {
    throw new Error(`Rol inválido. Roles válidos: ${VALID_ROLES.join(", ")}`);
  }

  const ref = db.collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Usuario no encontrado.");

  const updates = {updatedAt: FieldValue.serverTimestamp()};
  if (rol !== undefined) updates.rol = rol;
  if (areasPermitidas !== undefined) {
    updates.areasPermitidas = Array.isArray(areasPermitidas) ? areasPermitidas : [];
  }
  if (nombre !== undefined) updates.nombre = nombre;

  await ref.update(updates);
  return {id: uid};
}

async function deleteUser(uid) {
  const ref = db.collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Usuario no encontrado.");
  await ref.delete();
}

async function getEmailConfig() {
  const snap = await db.collection("config").doc("emails").get();
  if (!snap.exists) {
    return {recipients: [], ccRecipients: [], fromName: "Cielito Home"};
  }
  return snap.data();
}

async function saveEmailConfig({recipients, ccRecipients, fromName}) {
  await db.collection("config").doc("emails").set(
      {
        recipients: Array.isArray(recipients) ? recipients : [],
        ccRecipients: Array.isArray(ccRecipients) ? ccRecipients : [],
        fromName: fromName || "Cielito Home",
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
  );
}

module.exports = {
  listUsers,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  getEmailConfig,
  saveEmailConfig,
};
