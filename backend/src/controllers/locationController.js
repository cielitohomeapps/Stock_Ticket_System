const {
  listLocations,
  createLocation,
  updateLocation,
  mergeLocations,
  deleteLocation,
} = require("../services/location.service");
const {canonicalizeLocationName} = require("../services/location-normalization");
const { ticketDb: db } = require("../config/firebase");
const {logger} = require("../services/observability.service");
const {addAuditEntry} = require("../services/audit.service");

function respondLocationError(req, res, error) {
  const suppliedStatus = Number(error.statusCode);
  const statusCode = Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus < 600
    ? suppliedStatus
    : 500;
  const context = {
    eventType: "LOCATION_OPERATION_FAILED",
    module: "locations",
    requestId: req.id,
    correlationId: req.correlationId,
    errorType: error.code || error.name,
  };
  if (statusCode >= 500) logger.error("Fallo al consultar ubicaciones", context, error);
  else logger.warn("Operacion de ubicacion rechazada", context, error);
  return res.status(statusCode).json({
    error: statusCode >= 500 && process.env.NODE_ENV === "production"
      ? "No se pudo completar la operación de ubicación. Inténtalo más tarde o contacta al administrador."
      : error.message || "No se pudo completar la operación de ubicación.",
    ...(error.code ? {code: error.code} : {}),
    requestId: req.id,
  });
}

const locationController = {
  list: async (req, res) => {
    try {
      const locations = await listLocations(1000);
      return res.json({ locations });
    } catch (error) {
      return respondLocationError(req, res, error);
    }
  },

  create: async (req, res) => {
    try {
      const { name, aliases } = req.body;
      const created = await createLocation({ name, aliases });
      await addAuditEntry("locations", "LOCATION_CREATED", req.user.id, {locationId: created.id});
      return res.status(201).json(created);
    } catch (error) {
      return respondLocationError(req, res, error);
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, aliases } = req.body;
      const updated = await updateLocation(id, { name, aliases });
      await addAuditEntry("locations", "LOCATION_UPDATED", req.user.id, {locationId: id});
      return res.json(updated);
    } catch (error) {
      return respondLocationError(req, res, error);
    }
  },

  merge: async (req, res) => {
    try {
      const targetId = req.params.id;
      const merged = await mergeLocations(targetId, req.body.sourceLocationId, req.user?.id);
      return res.json({ok: true, location: merged});
    } catch (error) {
      return respondLocationError(req, res, error);
    }
  },

  delete: async (req, res) => {
    try {
      const { id } = req.params;
      await deleteLocation(id);
      await addAuditEntry("locations", "LOCATION_DELETED", req.user.id, {locationId: id});
      return res.json({ ok: true });
    } catch (error) {
      return respondLocationError(req, res, error);
    }
  },

  // GET /api/reports/locations or /api/reports/destinos
  reportByLocation: async (req, res) => {
    try {
      const pathGroup = String(req.path || '').toLowerCase().includes('/destinos') ? 'destino' : '';
      const queryGroup = String(req.query.groupBy || '').toLowerCase() === 'destino' ? 'destino' : '';
      const groupBy = pathGroup || queryGroup || 'area';
      const snapshot = await db.collection("tickets").get();
      const locations = groupBy === "destino" ? await listLocations(1000) : [];
      const agg = {};
      let totalItems = 0;
      let totalTickets = 0;

      snapshot.docs.forEach((d) => {
        const t = d.data();
        const rawKey = (t.metadata && t.metadata[groupBy]) ? String(t.metadata[groupBy]).trim() : "";
        const key = rawKey
          ? groupBy === "destino" ? canonicalizeLocationName(rawKey, locations) : rawKey
          : groupBy === "destino" ? "(sin destino)" : "(sin área)";
        if (!agg[key]) agg[key] = { label: key, ticketCount: 0, totalItems: 0, lastTicketAt: null };
        agg[key].ticketCount += 1;
        totalTickets += 1;
        const itemsCount = Array.isArray(t.items) ? t.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0;
        agg[key].totalItems += itemsCount;
        totalItems += itemsCount;
        const ts = t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : (t.createdAt || null);
        if (ts && (!agg[key].lastTicketAt || new Date(ts) > new Date(agg[key].lastTicketAt))) {
          agg[key].lastTicketAt = ts;
        }
      });

      const rows = Object.values(agg).sort((a, b) => b.ticketCount - a.ticketCount);
      return res.json({ rows, totalItems, totalTickets, groupBy, title: groupBy === 'destino' ? 'Destino' : 'Área' });
    } catch (error) {
      return respondLocationError(req, res, error);
    }
  },
};

module.exports = locationController;
