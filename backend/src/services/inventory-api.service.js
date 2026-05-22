const {admin} = require("../config/firebase");

const HTTP_TIMEOUT_MS = Number(process.env.INVENTORY_HTTP_TIMEOUT_MS || 15000);
const INVENTORY_SERVICE_UID = process.env.INVENTORY_SERVICE_UID || "inventory-service";

function getInventoryBaseUrl() {
  const fallbackUrl = "https://cielitohome-storage-backend.onrender.com/api";
  return (process.env.INVENTORY_API_BASE_URL || fallbackUrl).replace(/\/$/, "");
}

let cachedToken = null;
let tokenExpiry = 0;

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
    throw new Error("No se pudo obtener token de servicio para inventario.");
  }

  cachedToken = payload.idToken;
  tokenExpiry = now + (Number(payload.expiresIn || 3600) * 1000);
  return cachedToken;
}

async function callInventoryApi({path, method = "GET", body, clientToken}) {
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

  if (clientToken) {
    const clientAttempt = await requestWithToken(clientToken);
    if (clientAttempt.response.ok && clientAttempt.payload?.success !== false) {
      return clientAttempt.payload;
    }

    if (!isInvalidTokenError(clientAttempt.payload, clientAttempt.response.status)) {
      const message = normalizeMessage(clientAttempt.payload, clientAttempt.response.status);
      console.error(`[inventory-api] Client token request failed for ${path}:`, clientAttempt.response.status, message, clientAttempt.payload);
      throw new Error(message);
    }
    console.warn(`[inventory-api] Client token invalid for ${path}, falling back to service token.`, clientAttempt.response.status, clientAttempt.payload);
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

function extractProductsArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.products)) return payload.products;
  return [];
}

async function getAvailableAreas(clientToken) {
  const payload = await callInventoryApi({path: "/productos", method: "GET", clientToken});
  const products = extractProductsArray(payload);

  const areaSet = new Set();
  for (const item of products) {
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

  return Array.from(areaSet).sort((a, b) => a.localeCompare(b, "es"));
}

async function discountProduct(productId, qty, reason, clientToken) {
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
