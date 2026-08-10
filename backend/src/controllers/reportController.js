const { ticketDb: db } = require("../config/firebase");

function asText(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

function normalizeTicketDocument(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || null,
    approvedAt: data.approvedAt?.toDate ? data.approvedAt.toDate().toISOString() : data.approvedAt || null,
  };
}

function matchesAnalyticsFilters(ticket, { startDate, endDate, type, area, status }) {
  const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
  if (startDate && createdAt && createdAt < new Date(startDate)) return false;
  if (endDate && createdAt && createdAt > new Date(endDate)) return false;
  if (type && type !== 'ALL' && ticket.type !== type) return false;
  if (area && area !== 'ALL') {
    const ticketArea = String(ticket.metadata?.area || '').trim().toLowerCase();
    if (ticketArea !== String(area).trim().toLowerCase()) return false;
  }
  if (status && status !== 'ALL') {
    if (status === 'PENDING_APPROVAL') {
      return ['PENDIENTE', 'ENVIADO'].includes(ticket.status);
    }
    return ticket.status === status;
  }
  return true;
}

function getProductNameFromDoc(docData) {
  if (!docData || typeof docData !== 'object') return null

  const candidates = [
    docData.nombre,
    docData.Nombre,
    docData.name,
    docData.Name,
    docData.productName,
    docData.productname,
    docData.productoNombre,
    docData.producto_nombre,
    docData.nombreProducto,
    docData.nombre_producto,
    docData.Producto,
    docData.producto,
    docData.Dispositivo,
    docData.dispositivo,
    docData.itemName,
    docData.descripcion,
    docData.description,
    docData.titulo,
    docData.title,
  ]

  for (const candidate of candidates) {
    const text = asText(candidate)
    if (text) return text
  }

  return null
}

// Helper: get product name from ID via inventory API (no direct Firestore access)
const {getProductById} = require("../services/inventory-api.service");

async function getProductName(productId) {
  try {
    const detail = await getProductById(productId);
    const product = detail?.data || detail || {};
    const name = getProductNameFromDoc(product);
    if (name) return name;
  } catch (e) {
    // Silent fail, use ID as fallback
  }
  return productId;
}

const reportController = {
  // GET /api/reports/executive
  // Returns KPI data: top products, top destinations, monthly stats
  getExecutiveReport: async (req, res) => {
    try {
      const snapshot = await db.collection("tickets").get();
      const tickets = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Serialize timestamps
      tickets.forEach(t => {
        if (t.createdAt?.toDate) {
          t.createdAt = t.createdAt.toDate();
        }
      });

      // ────── TOP PRODUCTS (with real names) ──────
      const productMap = {};
      const productIdToName = {}; // Cache for product names
      
      // First pass: collect all product IDs
      tickets.forEach(ticket => {
        if (Array.isArray(ticket.items)) {
          ticket.items.forEach(item => {
            if (item.productId && !productIdToName[item.productId]) {
              productIdToName[item.productId] = null; // Mark for lookup
            }
          });
        }
      });

      // Batch lookup product names
      for (const productId of Object.keys(productIdToName)) {
        productIdToName[productId] = await getProductName(productId);
      }

      // Second pass: aggregate with real names
      tickets.forEach(ticket => {
        if (Array.isArray(ticket.items)) {
          ticket.items.forEach(item => {
            const productId = item.productId || "unknown";
            const name = productIdToName[productId] || item.productName || item.nombre || item.Nombre || item.Producto || item.producto || productId;
            if (!productMap[name]) {
              productMap[name] = { name, totalQty: 0, count: 0, productId };
            }
            productMap[name].totalQty += Number(item.qty) || 0;
            productMap[name].count += 1;
          });
        }
      });

      const topProducts = Object.values(productMap)
        .sort((a, b) => b.totalQty - a.totalQty)
        .slice(0, 10)
        .map(p => ({
          name: p.name,
          productId: p.productId,
          totalQty: p.totalQty,
          ticketCount: p.count
        }));

      // ────── TOP DESTINATIONS (with ticket details) ──────
      const destMap = {};
      tickets.forEach(ticket => {
        const dest = (ticket.metadata?.destino || "Sin destino").trim();
        if (!destMap[dest]) {
          destMap[dest] = { 
            destination: dest, 
            count: 0, 
            totalItems: 0,
            ticketIds: [],
            products: new Set()
          };
        }
        destMap[dest].count += 1;
        destMap[dest].ticketIds.push(ticket.id);
        if (Array.isArray(ticket.items)) {
          ticket.items.forEach(item => {
            destMap[dest].totalItems += Number(item.qty) || 0;
            const productId = item.productId;
            const fallbackName = item.productName || item.nombre || item.Nombre || item.Producto || item.producto || productId || "Sin nombre";
            const resolvedName = productId && productIdToName[productId] ? productIdToName[productId] : fallbackName;
            destMap[dest].products.add(resolvedName);
          });
        }
      });

      const topDestinations = Object.values(destMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map(d => ({
          destination: d.destination,
          ticketCount: d.count,
          totalItems: d.totalItems,
          uniqueProducts: d.products.size,
          ticketIds: d.ticketIds,
          products: Array.from(d.products).slice(0, 5) // Top 5 products for this destination
        }));

      // ────── MONTHLY STATS ──────
      const monthMap = {};
      tickets.forEach(ticket => {
        if (!ticket.createdAt) return;
        const date = new Date(ticket.createdAt);
        const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthMap[yearMonth]) {
          monthMap[yearMonth] = {
            month: yearMonth,
            ticketCount: 0,
            totalItems: 0,
            locations: new Set(),
            products: new Set()
          };
        }
        
        monthMap[yearMonth].ticketCount += 1;
        
        if (Array.isArray(ticket.items)) {
          ticket.items.forEach(item => {
            monthMap[yearMonth].totalItems += Number(item.qty) || 0;
            const productId = item.productId;
            const fallbackName = item.productName || item.nombre || item.Nombre || item.Producto || item.producto || productId || "Sin nombre";
            const resolvedName = productId && productIdToName[productId] ? productIdToName[productId] : fallbackName;
            monthMap[yearMonth].products.add(resolvedName);
          });
        }
        
        const location = (ticket.metadata?.destino || "Sin destino").trim();
        monthMap[yearMonth].locations.add(location);
      });

      const monthlyStats = Object.values(monthMap)
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12) // Last 12 months
        .map(m => ({
          month: m.month,
          ticketCount: m.ticketCount,
          totalItems: m.totalItems,
          uniqueLocations: m.locations.size,
          uniqueProducts: m.products.size
        }));

      // ────── SUMMARY KPIs ──────
      const totalTickets = tickets.length;
      const totalItems = tickets.reduce((sum, t) => {
        if (Array.isArray(t.items)) {
          return sum + t.items.reduce((s, item) => s + (Number(item.qty) || 0), 0);
        }
        return sum;
      }, 0);

      const statusCounts = {};
      tickets.forEach(t => {
        const status = t.status || "CREADO";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      const approvalRate = statusCounts["STOCK_ACTUALIZADO"] || statusCounts["NOTIFICADO"]
        ? Math.round(((statusCounts["STOCK_ACTUALIZADO"] || 0 + statusCounts["NOTIFICADO"] || 0) / totalTickets) * 100)
        : 0;

      const rejectionRate = statusCounts["RECHAZADO"]
        ? Math.round((statusCounts["RECHAZADO"] / totalTickets) * 100)
        : 0;

      // Average processing time (createdAt to approvedAt)
      let totalProcessingTime = 0;
      let processedCount = 0;
      tickets.forEach(t => {
        if (t.createdAt && t.approvedAt) {
          const createdDate = t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt);
          const approvedDate = t.approvedAt instanceof Date ? t.approvedAt : new Date(t.approvedAt);
          const diffMs = approvedDate - createdDate;
          totalProcessingTime += diffMs;
          processedCount += 1;
        }
      });

      const avgProcessingMinutes = processedCount > 0
        ? Math.round(totalProcessingTime / processedCount / 60000)
        : 0;

      return res.json({
        summary: {
          totalTickets,
          totalItems,
          approvalRate,
          rejectionRate,
          avgProcessingMinutes,
          pendingCount: statusCounts["EN_REVISION"] || 0
        },
        topProducts,
        topDestinations,
        monthlyStats,
        statusBreakdown: statusCounts
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  getAnalyticsTickets: async (req, res) => {
    try {
      const { startDate, endDate, type, area, status } = req.query;
      const snapshot = await db.collection('tickets').get();
      const tickets = snapshot.docs.map((doc) => normalizeTicketDocument(doc));

      const filtered = tickets.filter((ticket) =>
        matchesAnalyticsFilters(ticket, {
          startDate,
          endDate,
          type,
          area,
          status,
        })
      );

      return res.json({ tickets: filtered });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }
};

module.exports = reportController;
