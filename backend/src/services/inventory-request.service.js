function configurationError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = "INVENTORY_CONFIGURATION_ERROR";
  return error;
}

function normalizeInventoryBaseUrl(value) {
  const configured = String(value || "").trim();
  if (!configured) {
    throw configurationError("INVENTORY_API_BASE_URL no está configurada.");
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw configurationError("INVENTORY_API_BASE_URL no es una URL válida.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw configurationError("INVENTORY_API_BASE_URL debe usar HTTP(S) y no incluir credenciales.");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

function encodeInventoryPathSegment(value, field = "identificador") {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001F\u007F]/.test(normalized)) {
    const error = new Error(`${field} inválido.`);
    error.statusCode = 400;
    error.code = "INVALID_INVENTORY_IDENTIFIER";
    throw error;
  }
  return encodeURIComponent(normalized);
}

function mayUseInventoryServiceCredential(clientToken, allowServiceFallback) {
  return !clientToken || allowServiceFallback === true;
}

module.exports = {
  normalizeInventoryBaseUrl,
  encodeInventoryPathSegment,
  mayUseInventoryServiceCredential,
};
