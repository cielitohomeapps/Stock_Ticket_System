function normalizeArea(value) {
  return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
}

function canAccessArea(user, area) {
  if (user?.esAdminLevel) return true;
  const target = normalizeArea(area);
  if (!target) return false;
  const allowed = Array.isArray(user?.areasPermitidas) ? user.areasPermitidas : [];
  return allowed.some((value) => normalizeArea(value) === target);
}

function filterAllowedAreas(areas, user) {
  const values = Array.isArray(areas) ? areas : [];
  if (user?.esAdminLevel) return values;
  return values.filter((area) => canAccessArea(user, area));
}

function extractProductArea(payload) {
  const product = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  return product?.area ??
    product?.Area ??
    product?.departamento ??
    product?.Departamento ??
    product?.sector ??
    product?.Sector ??
    product?.categoria ??
    product?.Categoria ??
    null;
}

function requireBodyAreaAccess(req, res, next) {
  const area = req.body?.metadata?.area;
  if (!canAccessArea(req.user, area)) {
    return res.status(403).json({
      error: "No tienes permiso para operar en el área indicada.",
      code: "AREA_FORBIDDEN",
      requestId: req.id,
    });
  }
  return next();
}

function requireQueryAreaAccess(req, res, next) {
  if (!canAccessArea(req.user, req.query?.area)) {
    return res.status(403).json({
      error: "No tienes permiso para consultar el área indicada.",
      code: "AREA_FORBIDDEN",
      requestId: req.id,
    });
  }
  return next();
}

module.exports = {
  normalizeArea,
  canAccessArea,
  filterAllowedAreas,
  extractProductArea,
  requireBodyAreaAccess,
  requireQueryAreaAccess,
};
