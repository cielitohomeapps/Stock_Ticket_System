const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeInventoryBaseUrl,
  encodeInventoryPathSegment,
  mayUseInventoryServiceCredential,
} = require("../src/services/inventory-request.service");
const {
  canAccessArea,
  filterAllowedAreas,
  extractProductArea,
} = require("../src/services/area-access.service");
const {
  canCreateUser,
  canUpdateUser,
  canDeleteUser,
} = require("../src/services/user-policy.service");
const {normalizeEmailAddresses} = require("../src/services/input-validation.service");
const {createRateLimiter, securityHeaders} = require("../src/middleware/security");

function fakeResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test("codifica identificadores de inventario como un único segmento de ruta", () => {
  const encoded = encodeInventoryPathSegment("../admin?mode=write", "productId");
  assert.equal(encoded, "..%2Fadmin%3Fmode%3Dwrite");
  const url = new URL(`/api/productos/${encoded}`, "https://inventory.example");
  assert.equal(url.pathname, "/api/productos/..%2Fadmin%3Fmode%3Dwrite");
  assert.doesNotMatch(url.pathname, /\/api\/admin/);
});

test("la URL de inventario falla cerrada y solo acepta HTTP(S) sin credenciales", () => {
  assert.throws(() => normalizeInventoryBaseUrl(""), (error) => error.code === "INVENTORY_CONFIGURATION_ERROR");
  assert.throws(() => normalizeInventoryBaseUrl("file:///tmp/data"), /HTTP\(S\)/);
  assert.throws(() => normalizeInventoryBaseUrl("https://user:pass@example.com/api"), /credenciales/);
  assert.equal(normalizeInventoryBaseUrl("https://inventory.example/api/"), "https://inventory.example/api");
});

test("los endpoints de usuario no pueden escalar silenciosamente a la cuenta de servicio", () => {
  assert.equal(mayUseInventoryServiceCredential("user-token", false), false);
  assert.equal(mayUseInventoryServiceCredential("user-token", true), true);
  assert.equal(mayUseInventoryServiceCredential(null, false), true);
});

test("aplica autorización por área en el backend", () => {
  const user = {esAdminLevel: false, areasPermitidas: ["Almacén Norte"]};
  assert.equal(canAccessArea(user, "  ALMACEN norte "), true);
  assert.equal(canAccessArea(user, "Finanzas"), false);
  assert.equal(canAccessArea({...user, esAdminLevel: true}, "Finanzas"), true);
  assert.deepEqual(filterAllowedAreas(["Finanzas", "Almacen Norte"], user), ["Almacen Norte"]);
  assert.equal(extractProductArea({data: {Departamento: "Almacén Norte"}}), "Almacén Norte");
});

test("un admin no puede crear privilegios ni modificar o eliminar a otro admin", () => {
  const admin = {role: "admin", email: "admin@example.com"};
  const targetAdmin = {rol: "superadmin", email: "root@example.com"};
  const normalUser = {rol: "usuario", email: "user@example.com"};
  assert.equal(canCreateUser(admin, "superadmin"), false);
  assert.equal(canUpdateUser(admin, targetAdmin, "usuario"), false);
  assert.equal(canDeleteUser(admin, targetAdmin), false);
  assert.equal(canUpdateUser(admin, normalUser, "jefe_area"), true);
  assert.equal(canDeleteUser(admin, normalUser), true);
});

test("ni un superadmin puede eliminar su propia cuenta administrativa", () => {
  const actor = {role: "superadmin", email: "root@example.com"};
  assert.equal(canDeleteUser(actor, {rol: "superadmin", email: "ROOT@example.com"}), false);
  assert.equal(canUpdateUser(actor, {rol: "admin", email: "admin@example.com"}, "usuario"), true);
});

test("rechaza direcciones de correo con inyección de cabeceras", () => {
  assert.deepEqual(normalizeEmailAddresses([" OPS@Example.com "]), ["ops@example.com"]);
  assert.throws(() => normalizeEmailAddresses(["victim@example.com\r\nBcc: attacker@example.com"]), /inválida/);
});

test("limita operaciones sensibles por identidad autenticada", () => {
  let currentTime = 1_000;
  const limiter = createRateLimiter({windowMs: 60_000, max: 2, scope: "test", now: () => currentTime});
  const req = {user: {id: "user-1"}, id: "request-1", socket: {remoteAddress: "127.0.0.1"}};
  let allowed = 0;

  const first = fakeResponse();
  limiter(req, first, () => { allowed += 1; });
  const second = fakeResponse();
  limiter(req, second, () => { allowed += 1; });
  const blocked = fakeResponse();
  limiter(req, blocked, () => { allowed += 1; });

  assert.equal(allowed, 2);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, "RATE_LIMITED");

  currentTime += 60_001;
  const afterReset = fakeResponse();
  limiter(req, afterReset, () => { allowed += 1; });
  assert.equal(allowed, 3);
});

test("agrega cabeceras defensivas sin depender de middleware externo", () => {
  const res = fakeResponse();
  let called = false;
  securityHeaders({}, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
  assert.match(res.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
});

test("neutraliza fórmulas CSV y bloquea URLs absolutas para no filtrar tokens", async () => {
  const {escapeCsvCell} = await import("../../frontend/src/utils/csvSecurity.js");
  const {buildApiUrl} = await import("../../frontend/src/utils/apiSecurity.js");
  assert.equal(escapeCsvCell("=HYPERLINK(\"https://evil.example\")"), "\"'=HYPERLINK(\"\"https://evil.example\"\")\"");
  assert.equal(buildApiUrl("/api", "/tickets"), "/api/tickets");
  assert.throws(() => buildApiUrl("/api", "https://evil.example/steal"), /relativa/);
  assert.throws(() => buildApiUrl("/api", "//evil.example/steal"), /relativa/);
});
