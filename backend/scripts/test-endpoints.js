#!/usr/bin/env node

/**
 * Test if client token (Firebase token) works with inventory API
 * Usage: Manually run a ticket approval and check logs
 * 
 * Better approach: check what the actual inventory API expects
 */

require("dotenv").config();

const INVENTORY_API_BASE = (process.env.INVENTORY_API_BASE_URL || "https://cielitohome-storage-backend.onrender.com/api").replace(/\/$/, "");

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
    const text = await response.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    return { response, payload, text };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Timeout after ${HTTP_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function testEndpointInfo() {
  console.log("\n" + "=".repeat(80));
  console.log("INVENTORY API ENDPOINT ANALYSIS");
  console.log("=".repeat(80));
  console.log(`\nAPI Base: ${INVENTORY_API_BASE}\n`);

  console.log("Checking what endpoints exist by testing various common patterns...\n");

  const endpoints = [
    { method: "GET", path: "/", name: "Root endpoint" },
    { method: "GET", path: "/productos", name: "List all products" },
    { method: "GET", path: "/productos", name: "Products list", params: "?limit=1" },
    { method: "POST", path: "/productos/test-id/descontar", name: "Discount (POST)" },
    { method: "PUT", path: "/productos/test-id/descontar", name: "Discount (PUT)" },
    { method: "PATCH", path: "/productos/test-id/descontar", name: "Discount (PATCH)" },
    { method: "POST", path: "/productos/test-id/stock/decrease", name: "Stock decrease (alt)" },
    { method: "POST", path: "/productos/test-id/salida", name: "Salida endpoint" },
    { method: "POST", path: "/productos/test-id/reingreso", name: "Reingreso" },
    { method: "POST", path: "/stock/descontar", name: "Stock descontar (root level)" },
    { method: "GET", path: "/health", name: "Health check" },
    { method: "POST", path: "/auth", name: "Auth endpoint" },
  ];

  for (const ep of endpoints) {
    const url = `${INVENTORY_API_BASE}${ep.path}${ep.params || ""}`;
    try {
      const { response, payload } = await fetchWithTimeout(url, {
        method: ep.method,
        headers: { "Content-Type": "application/json" },
        body: ep.method !== "GET" ? JSON.stringify({ cantidad: 1 }) : undefined,
      });

      const statusEmoji =
        response.status === 404 ? "?" :
        response.status === 401 || response.status === 403 ? "🔒" :
        response.status >= 400 ? "❌" : "✓";

      console.log(`${statusEmoji} [${response.status}] ${ep.method.padEnd(6)} ${ep.path}`);
      if (ep.params) console.log(`          with params: ${ep.params}`);
      console.log(`          (${ep.name})`);
    } catch (error) {
      console.log(`💥 [ERROR] ${ep.method.padEnd(6)} ${ep.path} - ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("INTERPRETATION:");
  console.log("=".repeat(80));
  console.log("  ✓ = Working (200-299)");
  console.log("  🔒 = Auth error (401/403) - Need valid token");
  console.log("  ? = Not found (404) - Endpoint doesn't exist");
  console.log("  ❌ = Other error (400/5xx) - Check API implementation");
  console.log("\n");
}

testEndpointInfo().catch(console.error);
