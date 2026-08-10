const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || "sistemasch17@gmail.com").toLowerCase().trim();

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== "superadmin") {
    return res.status(403).json({error: "Se requiere rol superadmin"});
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user?.esAdminLevel) {
    return res.status(403).json({error: "Se requiere rol de administrador"});
  }
  return next();
}

function requireApprover(req, res, next) {
  if (!req.user?.esAdminLevel) {
    return res.status(403).json({error: "Tu rol no puede aprobar/rechazar tickets"});
  }
  return next();
}

module.exports = {
  SUPERADMIN_EMAIL,
  requireSuperAdmin,
  requireAdmin,
  requireApprover,
};
