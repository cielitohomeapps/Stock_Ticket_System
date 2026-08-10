const {admin} = require("../config/firebase");

const HTTP_TIMEOUT_MS = Number(process.env.INVENTORY_HTTP_TIMEOUT_MS || 15000);
const INVENTORY_SERVICE_UID = process.env.INVENTORY_SERVICE_UID || "inventory-service";

function getInventoryBaseUrl() {
  const fallbackUrl = "https://cielitohome-storage-backend.onrender.com/api";
  const configured = (process.env.INVENTORY_API_BASE_URL || "").trim();
  const url = (!configured || configured.includes("localhost")) ? fallbackUrl : configured;
  return url.replace(/\/$/, "");
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
      throw new Error(`Timeout invocando API externa (${HTTP_TIMEOUT_MS}ms).`);
    }
    throw error;
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
    console.error("[inventory-api] Failed to create custom token:", error.message);
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
    console.error("[inventory-api] Token exchange failed:", response.status, payload);
    throw new Error(
        `No se pudo obtener token de servicio para inventario (HTTP ${response.status}). ` +
        "Verifica que INVENTORY_SERVICE_UID y INVENTORY_AUTH_API_KEY sean correctos.",
    );
  }

  cachedToken = payload.idToken;
  tokenExpiry = now + (Number(payload.expiresIn || 3600) * 1000);
  console.log(`[inventory-api] Service token obtained, expires in ${payload.expiresIn || 3600}s`);
  return cachedToken;
}

async function callInventoryApi({path, method = "GET", body, clientToken, _retryCount = 0}) {
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
      if (isTransientError(clientAttempt.response.status) && _retryCount < 2) {
        console.warn(`[inventory-api] Transient error ${clientAttempt.response.status} for ${path}, retrying (${_retryCount + 1}/2)...`);
        await new Promise((r) => setTimeout(r, 1000 * (_retryCount + 1)));
        return callInventoryApi({path, method, body, clientToken, _retryCount: _retryCount + 1});
      }
      const message = normalizeMessage(clientAttempt.payload, clientAttempt.response.status);
      console.error(`[inventory-api] Client token request failed for ${path}:`, {
        status: clientAttempt.response.status,
        message,
        payload: clientAttempt.payload,
        requestBody: body,
      });
      throw new Error(message);
    }
    console.warn(`[inventory-api] Client token invalid/expired for ${path} (status ${clientAttempt.response.status}), falling back to service token.`, clientAttempt.payload);
  }

  let fallbackToken = await getServiceToken();
  let fallbackAttempt = await requestWithToken(fallbackToken);

  const staticToken = (process.env.INVENTORY_STATIC_BEARER_TOKEN || "").trim();
  if (staticToken && fallbackAttempt.response.status >= 400 && isInvalidTokenError(fallbackAttempt.payload, fallbackAttempt.response.status)) {
    console.warn(`[inventory-api] Static service token invalid for ${path}, generating dynamic token.`);
    fallbackToken = await getServiceToken({forceRefreshStatic: true});
    fallbackAttempt = await requestWithToken(fallbackToken);
  }

  if (!fallbackAttempt.response.ok || fallbackAttempt.payload?.success === false) {
    const rawText = fallbackAttempt.payload && typeof fallbackAttempt.payload === 'object'
      ? JSON.stringify(fallbackAttempt.payload)
      : String(fallbackAttempt.payload);
    const message = normalizeMessage(fallbackAttempt.payload, fallbackAttempt.response.status);
    console.error(`[inventory-api] Service token request failed for ${path}:`, {
      status: fallbackAttempt.response.status,
      message,
      payload: rawText,
    });
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
    throw new Error(message);
  }

  return fallbackAttempt.payload;
}

async function getProductById(productId, clientToken) {
  return callInventoryApi({path: `/productos/${productId}`, method: "GET", clientToken});
}

function normalizeArea(area) {
  return String(area || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
}

async function getProductsByArea(area, clientToken) {
  if (!area) {
    return callInventoryApi({path: "/productos", method: "GET", clientToken});
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
      });
    } catch (error) {
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

async function getAvailableAreas(clientToken) {
  const now = Date.now();
  const tokenKey = clientToken ? String(clientToken).slice(-20) : 'service';

  if (cachedAreas[tokenKey] && cachedAreas[tokenKey].expiry > now) {
    return cachedAreas[tokenKey].areas;
  }

  const payload = await callInventoryApi({path: "/productos", method: "GET", clientToken});
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
  // Validate product exists before attempting discount
  try {
    const product = await getProductById(productId, clientToken);
    if (!product || (!product.data && !product.id)) {
      throw new Error(`Producto ${productId} no encontrado en inventario.`);
    }
  } catch (validateErr) {
    // If we can't even read the product, throw a clear error instead of a cryptic 500
    if (validateErr.message.includes("no encontrado") || validateErr.message.includes("Token de autenticación")) {
      throw validateErr;
    }
    // If validation fails for other reasons, log but continue with the discount attempt
    console.warn(`[inventory-api] Product validation failed for ${productId}:`, validateErr.message);
  }

  const body = {cantidad: qty};
  if (reason) body.motivo = reason;
  return callInventoryApi({
    path: `/productos/${productId}/descontar`,
    method: "POST",
    body,
    clientToken,
  });
}

async function reingressProduct(productId, qty, reason, clientToken) {
  // Validate product exists before attempting reingress
  try {
    const product = await getProductById(productId, clientToken);
    if (!product || (!product.data && !product.id)) {
      throw new Error(`Producto ${productId} no encontrado en inventario.`);
    }
  } catch (validateErr) {
    if (validateErr.message.includes("no encontrado") || validateErr.message.includes("Token de autenticación")) {
      throw validateErr;
    }
    console.warn(`[inventory-api] Product validation failed for ${productId}:`, validateErr.message);
  }

  return callInventoryApi({
    path: `/productos/${productId}/reingreso`,
    method: "POST",
    body: {cantidad: qty, motivo: reason || "Reingreso por ticket"},
    clientToken,
  });
}

module.exports = {
  getProductById,
  getProductsByArea,
  getAvailableAreas,
  discountProduct,
  reingressProduct,
};
