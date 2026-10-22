const {ticketDb: db, FieldValue} = require("../config/firebase");
const {
  normalizeLocationName,
  findCanonicalLocation,
  normalizeLocationAliases,
  assertLocationTermsAvailable,
} = require("./location-normalization");

function slugify(value) {
  return normalizeLocationName(value).replace(/\s+/g, "-");
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
    aliases: normalizeLocationAliases(data.name || "", data.aliases),
    createdAt: serializeFirestoreTimestamp(data.createdAt),
  }
}

async function resolveLocationRecord(name) {
  const raw = String(name || "").trim();
  const locations = await listLocations(1000);
  const match = findCanonicalLocation(raw, locations);
  if (match.status === "matched") return match.location;

  const error = new Error(match.status === "ambiguous"
    ? "El destino coincide con más de una ubicación. Contacta al administrador para corregir los aliases."
    : "Selecciona una ubicación registrada. Si no aparece, solicita al administrador que la agregue al catálogo.");
  error.statusCode = match.status === "ambiguous" ? 409 : 400;
  error.code = match.status === "ambiguous" ? "AMBIGUOUS_LOCATION" : "LOCATION_NOT_FOUND";
  throw error;
}

async function listLocations(limit = 1000) {
  const snap = await db.collection("ubicaciones").limit(limit).get();
  return snap.docs.map(serializeLocationDoc).sort((a, b) => a.name.localeCompare(b.name));
}

async function createLocation({ name, aliases = [] }) {
  if (!name || !String(name).trim()) throw new Error("name requerido");
  const normalizedName = String(name).trim();
  const slug = slugify(normalizedName);
  const col = db.collection("ubicaciones");
  const existingLocations = await listLocations(1000);
  const locationAliases = normalizeLocationAliases(normalizedName, aliases);
  assertLocationTermsAvailable({name: normalizedName, aliases: locationAliases}, existingLocations);

  const payload = { name: normalizedName, slug, aliases: locationAliases, createdAt: FieldValue.serverTimestamp() };
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
  const existingLocation = serializeLocationDoc(existingDoc);
  const existingLocations = await listLocations(1000);

  const updates = {};
  if (name && String(name).trim()) {
    const normalizedName = String(name).trim();
    const slug = slugify(normalizedName);
    updates.name = normalizedName;
    updates.slug = slug;
  }
  if (aliases !== undefined || updates.name) {
    const aliasesToKeep = aliases === undefined
      ? existingLocation.aliases
      : Array.isArray(aliases) ? aliases : [aliases];
    updates.aliases = normalizeLocationAliases(
        updates.name || existingLocation.name,
        [existingLocation.name, ...aliasesToKeep],
    );
  }
  if (Object.keys(updates).length === 0) {
    throw new Error("Nada para actualizar");
  }
  assertLocationTermsAvailable({
    id,
    name: updates.name || existingLocation.name,
    aliases: updates.aliases || existingLocation.aliases,
  }, existingLocations, id);

  await docRef.update(updates);
  const updatedDoc = await docRef.get();
  return serializeLocationDoc(updatedDoc);
}

async function mergeLocations(targetId, sourceId, mergedBy) {
  if (!targetId || !sourceId || targetId === sourceId) {
    throw new Error("Selecciona dos ubicaciones diferentes para unificar.");
  }

  const col = db.collection("ubicaciones");
  const targetRef = col.doc(targetId);
  const sourceRef = col.doc(sourceId);
  const auditRef = db.collection("locationAudits").doc();
  let mergedLocation = null;

  await db.runTransaction(async (trx) => {
    const catalogSnapshot = await trx.get(col);
    const catalog = catalogSnapshot.docs.map(serializeLocationDoc);
    const target = catalog.find((location) => location.id === targetId);
    const source = catalog.find((location) => location.id === sourceId);
    if (!target || !source) {
      const error = new Error("No se encontró una de las ubicaciones seleccionadas.");
      error.statusCode = 404;
      error.code = "LOCATION_NOT_FOUND";
      throw error;
    }

    const aliases = normalizeLocationAliases(target.name, [
      ...(target.aliases || []),
      source.name,
      ...(source.aliases || []),
    ]);
    assertLocationTermsAvailable(
        {id: targetId, name: target.name, aliases},
        catalog.filter((location) => location.id !== targetId && location.id !== sourceId),
    );

    trx.update(targetRef, {
      aliases,
      updatedAt: FieldValue.serverTimestamp(),
    });
    trx.delete(sourceRef);
    trx.create(auditRef, {
      action: "LOCATION_MERGED",
      user: mergedBy || null,
      targetLocationId: targetId,
      targetLocationName: target.name,
      sourceLocationId: sourceId,
      sourceLocationName: source.name,
      createdAt: FieldValue.serverTimestamp(),
    });
    mergedLocation = {...target, aliases};
  });

  return mergedLocation;
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
  normalizeName: normalizeLocationName,
  slugify,
  resolveLocationRecord,
  listLocations,
  createLocation,
  updateLocation,
  mergeLocations,
  deleteLocation,
};
