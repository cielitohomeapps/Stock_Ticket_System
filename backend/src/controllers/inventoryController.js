const {
  getProductById,
  getProductsByArea,
  getAvailableAreas,
} = require("../services/inventory-api.service");
const {
  canAccessArea,
  filterAllowedAreas,
  extractProductArea,
} = require("../services/area-access.service");

function respondInventoryError(req, res, error) {
  const errorStatus = Number(error.statusCode);
  const status = Number.isInteger(errorStatus) && errorStatus >= 400 && errorStatus < 600
    ? errorStatus
    : 500;
  return res.status(status).json({
    error: status >= 500 && process.env.NODE_ENV === "production"
      ? "No se pudo consultar el inventario."
      : error.message || "No se pudo consultar el inventario.",
    ...(error.code ? {code: error.code} : {}),
    requestId: req.id,
  });
}

const inventoryController = {
  // GET /api/inventory/products/:id
  getProduct: async (req, res) => {
    try {
      const data = await getProductById(req.params.id, req.authToken, {allowServiceFallback: false});
      if (!canAccessArea(req.user, extractProductArea(data))) {
        return res.status(403).json({
          error: "No tienes permiso para consultar este producto.",
          code: "AREA_FORBIDDEN",
          requestId: req.id,
        });
      }
      return res.json(data);
    } catch (error) {
      return respondInventoryError(req, res, error);
    }
  },

  // GET /api/inventory/products
  getProducts: async (req, res) => {
    try {
      const data = await getProductsByArea(req.query.area, req.authToken, {allowServiceFallback: false});
      return res.json(data);
    } catch (error) {
      return respondInventoryError(req, res, error);
    }
  },

  // GET /api/inventory/areas
  getAreas: async (req, res) => {
    try {
      const areas = await getAvailableAreas(req.authToken, {allowServiceFallback: false});
      return res.json({areas: filterAllowedAreas(areas, req.user)});
    } catch (error) {
      return respondInventoryError(req, res, error);
    }
  },
};

module.exports = inventoryController;
