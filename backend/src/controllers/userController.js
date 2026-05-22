const {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getEmailConfig,
  saveEmailConfig,
} = require("../services/user.service");
const {addAuditEntry} = require("../services/audit.service");

const userController = {
  // GET /api/me
  getMe: (req, res) => {
    res.json({
      id: req.user.id,
      email: req.user.email,
      nombre: req.user.nombre,
      role: req.user.role,
      areasPermitidas: req.user.areasPermitidas,
      esAdminLevel: req.user.esAdminLevel,
    });
  },

  // GET /api/admin/users
  list: async (_req, res) => {
    try {
      const users = await listUsers();
      return res.json({users});
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // POST /api/admin/users
  create: async (req, res) => {
    try {
      const {email, rol, areasPermitidas, nombre} = req.body;
      const result = await createUser({email, rol, areasPermitidas, nombre});
      await addAuditEntry("users", "USER_CREATED", req.user.id, {email, rol});
      return res.status(201).json(result);
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // PATCH /api/admin/users/:uid
  update: async (req, res) => {
    try {
      const {rol, areasPermitidas, nombre} = req.body;
      const result = await updateUser(req.params.uid, {rol, areasPermitidas, nombre});
      await addAuditEntry("users", "USER_UPDATED", req.user.id, {uid: req.params.uid, rol});
      return res.json(result);
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // DELETE /api/admin/users/:uid
  delete: async (req, res) => {
    try {
      await deleteUser(req.params.uid);
      await addAuditEntry("users", "USER_DELETED", req.user.id, {uid: req.params.uid});
      return res.json({ok: true});
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // GET /api/admin/email-config
  getEmailConfig: async (_req, res) => {
    try {
      const config = await getEmailConfig();
      return res.json(config);
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // PUT /api/admin/email-config
  updateEmailConfig: async (req, res) => {
    try {
      const {recipients, ccRecipients, fromName} = req.body;
      await saveEmailConfig({recipients, ccRecipients, fromName});
      return res.json({ok: true});
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },
};

module.exports = userController;