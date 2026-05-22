const {
  getProductById,
  getProductsByArea,
  getAvailableAreas,
} = require("../services/inventory-api.service");

const inventoryController = {
  // GET /api/inventory/products/:id
  getProduct: async (req, res) => {
    try {
      const data = await getProductById(req.params.id, req.authToken);
      return res.json(data);
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // GET /api/inventory/products
  getProducts: async (req, res) => {
    try {
      const data = await getProductsByArea(req.query.area, req.authToken);
      return res.json(data);
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // GET /api/inventory/areas
  getAreas: async (_req, res) => {
    try {
      const areas = await getAvailableAreas(_req.authToken);
      return res.json({areas});
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },
};

module.exports = inventoryController;