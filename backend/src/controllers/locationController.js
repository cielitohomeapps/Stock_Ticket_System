const { listLocations, createLocation, updateLocation, deleteLocation } = require("../services/location.service");
const { db } = require("../config/firebase");

const locationController = {
  list: async (_req, res) => {
    try {
      const locations = await listLocations(500);
      return res.json({ locations });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, aliases } = req.body;
      const created = await createLocation({ name, aliases });
      return res.status(201).json(created);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, aliases } = req.body;
      const updated = await updateLocation(id, { name, aliases });
      return res.json(updated);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  delete: async (req, res) => {
    try {
      const { id } = req.params;
      await deleteLocation(id);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  // GET /api/reports/locations or /api/reports/destinos
  reportByLocation: async (req, res) => {
    try {
      const pathGroup = String(req.path || '').toLowerCase().includes('/destinos') ? 'destino' : '';
      const queryGroup = String(req.query.groupBy || '').toLowerCase() === 'destino' ? 'destino' : '';
      const groupBy = pathGroup || queryGroup || 'area';
      const snapshot = await db.collection("tickets").get();
      const agg = {};
      let totalItems = 0;
      let totalTickets = 0;

      snapshot.docs.forEach((d) => {
        const t = d.data();
        const key = (t.metadata && t.metadata[groupBy]) ? String(t.metadata[groupBy]).trim() : groupBy === 'destino' ? "(sin destino)" : "(sin área)";
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
      return res.status(400).json({ error: error.message });
    }
  },
};

module.exports = locationController;
