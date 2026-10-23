const PRIVILEGED_ROLES = new Set(["admin", "superadmin"]);

function isPrivilegedRole(role) {
  return PRIVILEGED_ROLES.has(String(role || "").toLowerCase());
}

function canCreateUser(actor, requestedRole) {
  return actor?.role === "superadmin" || !isPrivilegedRole(requestedRole);
}

function canUpdateUser(actor, targetUser, requestedRole) {
  if (actor?.role === "superadmin") return true;
  if (!targetUser) return false;
  return !isPrivilegedRole(targetUser.rol || targetUser.role) && !isPrivilegedRole(requestedRole);
}

function canDeleteUser(actor, targetUser) {
  if (!targetUser) return false;
  const isSelf = String(actor?.email || "").toLowerCase() === String(targetUser.email || "").toLowerCase();
  if (isSelf) return false;
  return actor?.role === "superadmin" || !isPrivilegedRole(targetUser.rol || targetUser.role);
}

module.exports = {
  isPrivilegedRole,
  canCreateUser,
  canUpdateUser,
  canDeleteUser,
};
