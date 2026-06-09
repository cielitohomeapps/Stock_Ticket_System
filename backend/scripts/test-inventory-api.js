#!/usr/bin/env node

/**
 * Diagnostic script to test inventory API connectivity and endpoints
 * Run: node backend/scripts/test-inventory-api.js
 */

require("dotenv").config();

const INVENTORY_API_BASE = (process.env.INVENTORY_API_BASE_URL || "https://cielitohome-storage-backend.onrender.com/api").replace(/\/$/, "");
const STATIC_TOKEN = (process.env.INVENTORY_STATIC_BEARER_TOKEN || "").trim();
const API_KEY = (process.env.INVENTORY_AUTH_API_KEY || "").trim();
const SERVICE_UID = process.env.INVENTORY_SERVICE_UID || "inventory-service";

const HTTP_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}) {
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

    return { response, payload };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Timeout after ${HTTP_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getServiceToken() {
  if (!API_KEY) {
    console.log("  ✗ No API_KEY configured (INVENTORY_AUTH_API_KEY)");
    return null;
  }

  try {
    const url = `${INVENTORY_API_BASE}/auth`;
    const { response, payload } = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: SERVICE_UID }),
    });

    if (response.ok && payload?.token) {
      console.log(`  ✓ Generated dynamic token: ${payload.token.substring(0, 20)}...`);
      return payload.token;
    } else {
      console.log(`  ✗ Failed to generate token: ${response.status} - ${JSON.stringify(payload)}`);
      return null;
    }
  } catch (error) {
    console.log(`  ✗ Error generating token: ${error.message}`);
    return null;
  }
}

async function testEndpoint(method, path, body = null, token = null) {
  const url = `${INVENTORY_API_BASE}${path}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const { response, payload } = await fetchWithTimeout(url, options);
    console.log(`  ✓ ${method} ${path}`);
    console.log(`    Status: ${response.status}`);
    console.log(`    Response:`, JSON.stringify(payload, null, 4).split("\n").slice(0, 5).join("\n"));
    return { status: response.status, payload };
  } catch (error) {
    console.log(`  ✗ ${method} ${path}`);
    console.log(`    Error: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log("\n" + "=".repeat(80));
  console.log("INVENTORY API DIAGNOSTIC");
  console.log("=".repeat(80));
  console.log(`API Base: ${INVENTORY_API_BASE}`);
  console.log(`Static Token: ${STATIC_TOKEN ? "✓ Configured" : "✗ NOT configured"}`);
  console.log(`API Key: ${API_KEY ? "✓ Configured" : "✗ NOT configured"}`);
  console.log(`Service UID: ${SERVICE_UID}`);

  console.log("\n1. Testing basic connectivity (no auth)...");
  await testEndpoint("GET", "/", null, null);

  console.log("\n2. Testing with STATIC TOKEN...");
  if (STATIC_TOKEN) {
    await testEndpoint("GET", "/productos", null, STATIC_TOKEN);
  } else {
    console.log("  ⚠ Skipped: No static token configured");
  }

  console.log("\n3. Attempting to generate DYNAMIC TOKEN...");
  const dynamicToken = await getServiceToken();

  if (dynamicToken) {
    console.log("\n4. Testing with DYNAMIC TOKEN...");
    await testEndpoint("GET", "/productos", null, dynamicToken);

    console.log("\n5. Testing discount endpoint with dynamic token...");
    await testEndpoint("POST", "/productos/TEST-PRODUCT-ID/descontar", {
      cantidad: 5,
      motivo: "Test",
    }, dynamicToken);
  }

  console.log("\n" + "=".repeat(80));
  console.log("DIAGNOSTIC COMPLETE");
  console.log("=".repeat(80));
  console.log("\nRECOMMENDATIONS:");
  if (STATIC_TOKEN && dynamicToken === null) {
    console.log("- The static token is invalid (401 error)");
    console.log("- The dynamic token generation failed (no API_KEY or auth endpoint down)");
    console.log("- ACTION: Check INVENTORY_STATIC_BEARER_TOKEN and INVENTORY_AUTH_API_KEY in .env");
  } else if (dynamicToken) {
    console.log("- Dynamic token generation works!");
    console.log("- The app should use dynamic tokens instead of static token");
  }
  console.log("");
}

runTests().catch(console.error);
