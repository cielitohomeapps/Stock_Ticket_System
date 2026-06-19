const {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getEmailConfig,
  saveEmailConfig,
} = require("../services/user.service");
const {addAuditEntry} = require("../services/audit.service");

const userController = {
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

      // Solo superadmin puede crear admins o superadmins
      if (req.user.role !== "superadmin" && ["admin", "superadmin"].includes(rol)) {
        return res.status(403).json({error: "Solo un superadmin puede crear administradores"});
      }

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

      // Solo superadmin puede cambiar el rol a admin/superadmin
      if (req.user.role !== "superadmin" && ["admin", "superadmin"].includes(rol)) {
        return res.status(403).json({error: "Solo un superadmin puede asignar roles administrativos"});
      }

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
      const targetUid = req.params.uid;

      // Solo superadmin puede eliminar admins o superadmins
      const targetUser = await getUserById(targetUid);
      if (targetUser && ["admin", "superadmin"].includes(targetUser.rol)) {
        if (req.user.role !== "superadmin") {
          return res.status(403).json({error: "Solo un superadmin puede eliminar administradores"});
        }
      }

      await deleteUser(targetUid);
      await addAuditEntry("users", "USER_DELETED", req.user.id, {uid: targetUid});
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