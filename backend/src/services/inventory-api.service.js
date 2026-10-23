const {admin} = require("../config/firebase");
const {logger} = require("./observability.service");
const {
  normalizeInventoryBaseUrl,
  encodeInventoryPathSegment,
  mayUseInventoryServiceCredential,
} = require("./inventory-request.service");

const HTTP_TIMEOUT_MS = Number(process.env.INVENTORY_HTTP_TIMEOUT_MS || 15000);
const INVENTORY_SERVICE_UID = process.env.INVENTORY_SERVICE_UID || "inventory-service";

function inventoryUnavailableError() {
  const error = new Error(
      "No se pudo conectar con el sistema de inventarios. Revisa que esté activo e inténtalo de nuevo.",
  );
  error.statusCode = 503;
  error.code = "INVENTORY_UNAVAILABLE";
  return error;
}

function getInventoryBaseUrl() {
  return normalizeInventoryBaseUrl(process.env.INVENTORY_API_BASE_URL);
}

let cachedToken = null;
let tokenExpiry = 0;
let cachedAreas = {};

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    return {response, payload};
  } catch (error) {
    if (error?.name === "AbortError") {
      logger.error("Tiempo de espera agotado al consultar dependencia externa", {
        eventType: "INVENTORY_CONNECTION_FAILED",
        module: "inventory",
      }, error);
      throw inventoryUnavailableError();
    }
    logger.error("Fallo la conexion con dependencia externa", {
      eventType: "INVENTORY_CONNECTION_FAILED",
      module: "inventory",
    }, error);
    throw inventoryUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

async function getServiceToken({forceRefreshStatic = false} = {}) {
  const staticToken = (process.env.INVENTORY_STATIC_BEARER_TOKEN || "").trim();
  if (staticToken && !forceRefreshStatic) {
    return staticToken;
  }

  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 60000) {
    return cachedToken;
  }

  const apiKey = process.env.INVENTORY_AUTH_API_KEY;
  if (!apiKey) {
    throw new Error("INVENTORY_AUTH_API_KEY no configurada. Agregala al archivo .env");
  }

  let customToken;
  try {
    customToken = await admin.auth().createCustomToken(INVENTORY_SERVICE_UID);
  } catch (error) {
    logger.error("No se pudo crear el token de servicio de inventario", {eventType: "INVENTORY_TOKEN_CREATION_FAILED", module: "inventory"}, error);
    throw new Error(
        "No se pudo firmar token Firebase. Configura backend/service-account.json " +
        "o las variables FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY en .env.",
    );
  }
  const {response, payload} = await fetchJsonWithTimeout(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
      {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({token: customToken, returnSecureToken: true}),
      },
  );

  if (!response.ok || !payload?.idToken) {
    logger.error("Fallo el intercambio del token de inventario", {eventType: "INVENTORY_TOKEN_EXCHANGE_FAILED", module: "inventory", statusCode: response.status});
    throw new Error(
        `No se pudo obtener token de servicio para inventario (HTTP ${response.status}). ` +
        "Verifica que INVENTORY_SERVICE_UID y INVENTORY_AUTH_API_KEY sean correctos.",
    );
  }

  cachedToken = payload.idToken;
  tokenExpiry = now + (Number(payload.expiresIn || 3600) * 1000);
  logger.info("Token de servicio de inventario renovado", {eventType: "INVENTORY_TOKEN_REFRESHED", module: "inventory", metadata: {expiresInSeconds: Number(payload.expiresIn || 3600)}});
  return cachedToken;
}

async function callInventoryApi({
  path,
  method = "GET",
  body,
  clientToken,
  allowServiceFallback = false,
  _retryCount = 0,
}) {
  const baseUrl = getInventoryBaseUrl();
  const url = `${baseUrl}${path}`;

  const requestWithToken = async (token) => fetchJsonWithTimeout(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const normalizeMessage = (payload, status) => (
    payload?.message || `Error ${status} invocando ${path}`
  );

  const isInvalidTokenError = (payload, status) => {
    const message = normalizeMessage(payload, status);
    const normalized = message
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

    return (
      status === 401 ||
      status === 403 ||
      (normalized.includes("token") && normalized.includes("invalido")) ||
      (normalized.includes("sesion") && normalized.includes("expir")) ||
      normalized.includes("unauthorized") ||
      normalized.includes("no autorizado")
    );
  };

  const isTransientError = (status) => status >= 500 || status === 429;

  if (clientToken) {
    const clientAttempt = await requestWithToken(clientToken);
    if (clientAttempt.response.ok && clientAttempt.payload?.success !== false) {
      return clientAttempt.payload;
    }

    const clientIsTokenError = isInvalidTokenError(clientAttempt.payload, clientAttempt.response.status);
    if (!clientIsTokenError) {
      // Retry on transient errors
      if (method === "GET" && isTransientError(clientAttempt.response.status) && _retryCount < 2) {
        logger.warn("Error transitorio de inventario; se reintentara", {eventType: "INVENTORY_RETRY", module: "inventory", statusCode: clientAttempt.response.status, route: path, metadata: {attempt: _retryCount + 1}});
        await new Promise((r) => setTimeout(r, 1000 * (_retryCount + 1)));
        return callInventoryApi({path, method, body, clientToken, allowServiceFallback, _retryCount: _retryCount + 1});
      }
      const message = normalizeMessage(clientAttempt.payload, clientAttempt.response.status);
      logger.error("La API de inventario rechazo una solicitud", {eventType: "INVENTORY_REQUEST_FAILED", module: "inventory", statusCode: clientAttempt.response.status, route: path});
      if (isTransientError(clientAttempt.response.status)) {
        throw inventoryUnavailableError();
      }
      throw new Error(`La API de inventario rechazo la operacion (HTTP ${clientAttempt.response.status}).`);
    }
    if (!mayUseInventoryServiceCredential(clientToken, allowServiceFallback)) {
      const error = new Error("El sistema de inventarios rechazó el acceso del usuario.");
      error.statusCode = 403;
      error.code = "INVENTORY_ACCESS_DENIED";
      throw error;
    }
    logger.warn("Token de usuario rechazado por inventario; se usara la cuenta de servicio", {eventType: "INVENTORY_CLIENT_TOKEN_REJECTED", module: "inventory", statusCode: clientAttempt.response.status, route: path});
  }

  let fallbackToken = await getServiceToken();
  let fallbackAttempt = await requestWithToken(fallbackToken);

  const staticToken = (process.env.INVENTORY_STATIC_BEARER_TOKEN || "").trim();
  if (staticToken && fallbackAttempt.response.status >= 400 && isInvalidTokenError(fallbackAttempt.payload, fallbackAttempt.response.status)) {
    logger.warn("Token estatico de inventario rechazado; se generara uno dinamico", {eventType: "INVENTORY_STATIC_TOKEN_REJECTED", module: "inventory", statusCode: fallbackAttempt.response.status, route: path});
    fallbackToken = await getServiceToken({forceRefreshStatic: true});
    fallbackAttempt = await requestWithToken(fallbackToken);
  }

  if (!fallbackAttempt.response.ok || fallbackAttempt.payload?.success === false) {
    const message = normalizeMessage(fallbackAttempt.payload, fallbackAttempt.response.status);
    logger.error("Fallo una solicitud de servicio a inventario", {eventType: "INVENTORY_SERVICE_REQUEST_FAILED", module: "inventory", statusCode: fallbackAttempt.response.status, route: path});
    const normalized = message
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    if (normalized.includes("token") && normalized.includes("invalido")) {
      throw new Error(
          "Token de autenticación inválido en API de inventario. " +
          "Inicia sesión con Google en el frontend o configura INVENTORY_STATIC_BEARER_TOKEN en .env.",
      );
    }
    if (isTransientError(fallbackAttempt.response.status)) {
      throw inventoryUnavailableError();
    }
    throw new Error(message);
  }

  return fallbackAttempt.payload;
}

async function getProductById(productId, clientToken, options = {}) {
  const safeProductId = encodeInventoryPathSegment(productId, "productId");
  return callInventoryApi({
    path: `/productos/${safeProductId}`,
    method: "GET",
    clientToken,
    allowServiceFallback: options.allowServiceFallback === true,
  });
}

function normalizeArea(area) {
  return String(area || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
}

async function getProductsByArea(area, clientToken, options = {}) {
  const allowServiceFallback = options.allowServiceFallback === true;
  if (!area) {
    return callInventoryApi({path: "/productos", method: "GET", clientToken, allowServiceFallback});
  }

  const rawArea = String(area).trim();
  const normalizedArea = normalizeArea(rawArea);
  const candidates = [rawArea];
  if (normalizedArea && normalizedArea !== rawArea) {
    candidates.push(normalizedArea);
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await callInventoryApi({
        path: `/productos?area=${encodeURIComponent(candidate)}`,
        method: "GET",
        clientToken,
        allowServiceFallback,
      });
    } catch (error) {
      if (error.statusCode >= 500 || error.code === "INVENTORY_UNAVAILABLE") {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError || new Error("No se pudo consultar productos por area.");
}

function unwrapTypedValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (value.integerValue !== undefined) return value.integerValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (typeof value.booleanValue === 'boolean') return value.booleanValue;
  if (value.timestampValue) return value.timestampValue;
  if (value.mapValue?.fields) {
    const out = {};
    Object.entries(value.mapValue.fields).forEach(([k, v]) => { out[k] = unwrapTypedValue(v); });
    return out;
  }
  if (Array.isArray(value.arrayValue?.values)) return value.arrayValue.values.map(unwrapTypedValue);
  if (value.fields && typeof value.fields === 'object') {
    const out = {};
    Object.entries(value.fields).forEach(([k, v]) => { out[k] = unwrapTypedValue(v); });
    return out;
  }
  return value;
}

function flattenProduct(item) {
  if (item?.fields && typeof item.fields === 'object') {
    const decoded = unwrapTypedValue({ fields: item.fields }) || {};
    const fallbackId = typeof item.name === 'string' ? item.name.split('/').pop() : undefined;
    return { id: item.id || item._id || fallbackId, ...decoded };
  }
  if (item?.data && typeof item.data === 'object' && !Array.isArray(item.data)) {
    return { id: item.id || item._id || item.data.id, ...item.data };
  }
  return item;
}

function extractProductsArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.products)) return payload.products;
  return [];
}

async function getAvailableAreas(clientToken, options = {}) {
  const now = Date.now();
  const tokenKey = clientToken ? String(clientToken).slice(-20) : 'service';

  if (cachedAreas[tokenKey] && cachedAreas[tokenKey].expiry > now) {
    return cachedAreas[tokenKey].areas;
  }

  const payload = await callInventoryApi({
    path: "/productos",
    method: "GET",
    clientToken,
    allowServiceFallback: options.allowServiceFallback === true,
  });
  const products = extractProductsArray(payload);

  const areaSet = new Set();
  for (const rawItem of products) {
    const item = flattenProduct(rawItem);
    const value =
      item?.area ??
      item?.Area ??
      item?.departamento ??
      item?.Departamento ??
      item?.sector ??
      item?.Sector ??
      item?.categoria ??
      item?.Categoria;

    if (value && String(value).trim()) {
      areaSet.add(String(value).trim());
    }
  }

  cachedAreas[tokenKey] = {
    areas: Array.from(areaSet).sort((a, b) => a.localeCompare(b, "es")),
    expiry: now + 10 * 60 * 1000
  };
  return cachedAreas[tokenKey].areas;
}

async function discountProduct(productId, qty, reason, clientToken) {
  const safeProductId = encodeInventoryPathSegment(productId, "productId");
  const body = {cantidad: qty};
  if (reason) body.motivo = reason;
  return callInventoryApi({
    path: `/productos/${safeProductId}/descontar`,
    method: "POST",
    body,
    clientToken,
    allowServiceFallback: true,
  });
}

async function reingressProduct(productId, qty, reason, clientToken) {
  const safeProductId = encodeInventoryPathSegment(productId, "productId");
  return callInventoryApi({
    path: `/productos/${safeProductId}/reingreso`,
    method: "POST",
    body: {cantidad: qty, motivo: reason || "Reingreso por ticket"},
    clientToken,
    allowServiceFallback: true,
  });
}

module.exports = {
  getProductById,
  getProductsByArea,
  getAvailableAreas,
  discountProduct,
  reingressProduct,
};
