const {
  getProductById,
  getProductsByArea,
  getAvailableAreas,
} = require("../services/inventory-api.service");

function respondInventoryError(res, error) {
  const errorStatus = Number(error.statusCode);
  const status = Number.isInteger(errorStatus) && errorStatus >= 400 && errorStatus < 600
    ? errorStatus
    : 400;
  return res.status(status).json({
    error: error.message || "No se pudo consultar el inventario.",
    ...(error.code ? {code: error.code} : {}),
  });
}

const inventoryController = {
  // GET /api/inventory/products/:id
  getProduct: async (req, res) => {
    try {
      const data = await getProductById(req.params.id, req.authToken);
      return res.json(data);
    } catch (error) {
      return respondInventoryError(res, error);
    }
  },

  // GET /api/inventory/products
  getProducts: async (req, res) => {
    try {
      const data = await getProductsByArea(req.query.area, req.authToken);
      return res.json(data);
    } catch (error) {
      return respondInventoryError(res, error);
    }
  },

  // GET /api/inventory/areas
  getAreas: async (_req, res) => {
    try {
      const areas = await getAvailableAreas(_req.authToken);
      return res.json({areas});
    } catch (error) {
      return respondInventoryError(res, error);
    }
  },
};

module.exports = inventoryController;