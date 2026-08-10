const {ticketDb: db, FieldValue} = require("../config/firebase");

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function slugify(value) {
  return normalizeName(value).replace(/\s+/g, "-");
}

function serializeFirestoreTimestamp(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (typeof value === 'object' && value._seconds != null && value._nanoseconds != null) {
    return new Date(value._seconds * 1000 + Math.floor(value._nanoseconds / 1e6)).toISOString()
  }
  return null
}

function serializeLocationDoc(doc) {
  const data = doc.data() || {}
  return {
    id: doc.id,
    name: data.name || "",
    slug: data.slug || "",
    aliases: Array.isArray(data.aliases) ? data.aliases : [],
    createdAt: serializeFirestoreTimestamp(data.createdAt),
  }
}

async function ensureLocationRecord(name) {
  if (!name || !String(name).trim()) return { name: "", slug: "" };
  const raw = String(name).trim();
  const slug = slugify(raw);

  const col = db.collection("ubicaciones");
  // Try find by slug
  const snap = await col.where("slug", "==", slug).limit(1).get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    const data = doc.data();
    return { id: doc.id, name: data.name || raw, slug: data.slug || slug, aliases: data.aliases || [] };
  }

  // Not found: create a new canonical record
  const payload = {
    name: raw,
    slug,
    aliases: [raw],
    createdAt: FieldValue.serverTimestamp(),
  };

  const docRef = await col.add(payload);
  const createdDoc = await docRef.get();
  return serializeLocationDoc(createdDoc);
}

async function listLocations(limit = 100) {
  const snap = await db.collection("ubicaciones").limit(limit).get();
  return snap.docs.map(serializeLocationDoc);
}

async function createLocation({ name, aliases = [] }) {
  if (!name || !String(name).trim()) throw new Error("name requerido");
  const slug = slugify(name);
  const col = db.collection("ubicaciones");
  const exists = await col.where("slug", "==", slug).limit(1).get();
  if (!exists.empty) throw new Error("Ubicación ya existe");

  const payload = { name: String(name).trim(), slug, aliases: Array.isArray(aliases) ? aliases : [String(name).trim()], createdAt: FieldValue.serverTimestamp() };
  const docRef = await col.add(payload);
  const createdDoc = await docRef.get();
  return serializeLocationDoc(createdDoc);
}

async function updateLocation(id, { name, aliases }) {
  if (!id) throw new Error("id requerido");
  const col = db.collection("ubicaciones");
  const docRef = col.doc(id);
  const existingDoc = await docRef.get();
  if (!existingDoc.exists) throw new Error("Ubicación no encontrada");

  const updates = {};
  if (name && String(name).trim()) {
    const normalizedName = String(name).trim();
    const slug = slugify(normalizedName);
    const slugMatch = await col.where("slug", "==", slug).limit(1).get();
    if (!slugMatch.empty && slugMatch.docs[0].id !== id) {
      throw new Error("Otra ubicación con ese nombre ya existe");
    }
    updates.name = normalizedName;
    updates.slug = slug;
  }
  if (aliases !== undefined) {
    updates.aliases = Array.isArray(aliases) ? aliases.map((a) => String(a || "").trim()).filter(Boolean) : [String(aliases).trim()];
  }
  if (Object.keys(updates).length === 0) {
    throw new Error("Nada para actualizar");
  }

  await docRef.update(updates);
  const updatedDoc = await docRef.get();
  return serializeLocationDoc(updatedDoc);
}

async function deleteLocation(id) {
  if (!id) throw new Error("id requerido");
  const docRef = db.collection("ubicaciones").doc(id);
  const existingDoc = await docRef.get();
  if (!existingDoc.exists) throw new Error("Ubicación no encontrada");
  await docRef.delete();
  return true;
}

module.exports = {
  normalizeName,
  slugify,
  ensureLocationRecord,
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
};
