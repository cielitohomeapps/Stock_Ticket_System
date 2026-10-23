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
const {
  canCreateUser,
  canUpdateUser,
  canDeleteUser,
} = require("../services/user-policy.service");

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

      if (!canCreateUser(req.user, rol)) {
        return res.status(403).json({error: "Solo un superadmin puede crear administradores"});
      }

      const result = await createUser({email, rol, areasPermitidas, nombre});
      await addAuditEntry("users", "USER_CREATED", req.user.id, {userId: result.id, rol});
      return res.status(201).json(result);
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },

  // PATCH /api/admin/users/:uid
  update: async (req, res) => {
    try {
      const {rol, areasPermitidas, nombre} = req.body;
      const targetUser = await getUserById(req.params.uid);
      if (!targetUser) return res.status(404).json({error: "Usuario no encontrado"});

      if (!canUpdateUser(req.user, targetUser, rol)) {
        return res.status(403).json({error: "Solo un superadmin puede modificar usuarios administrativos"});
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

      const targetUser = await getUserById(targetUid);
      if (!targetUser) return res.status(404).json({error: "Usuario no encontrado"});
      if (!canDeleteUser(req.user, targetUser)) {
        return res.status(403).json({error: "No tienes permiso para eliminar este usuario"});
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
      await addAuditEntry("config:emails", "EMAIL_CONFIG_UPDATED", req.user.id, {
        recipientCount: Array.isArray(recipients) ? recipients.length : 0,
        ccRecipientCount: Array.isArray(ccRecipients) ? ccRecipients.length : 0,
      });
      return res.json({ok: true});
    } catch (error) {
      return res.status(400).json({error: error.message});
    }
  },
};

module.exports = userController;
