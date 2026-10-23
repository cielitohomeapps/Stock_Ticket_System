const test = require("node:test");
const assert = require("node:assert/strict");
const {MetricsStore} = require("../src/services/metrics.service");
const {AlertManager} = require("../src/services/alert.service");
const {sanitize} = require("../src/services/observability.service");
const {buildApprovedEmail} = require("../src/services/email.templates");

test("redacta secretos y enmascara correos antes de registrar contexto", () => {
  const result = sanitize({
    authorization: "Bearer secret",
    password: "secret",
    owner: "persona@example.com",
    nested: {privateKey: "key"},
  });
  assert.equal(result.authorization, "[REDACTED]");
  assert.equal(result.password, "[REDACTED]");
  assert.equal(result.nested.privateKey, "[REDACTED]");
  assert.equal(result.owner, "pe***@example.com");
});

test("preserva rutas grpc al sanitizar errores y enmascara correos del stack", () => {
  const stack = "Error: FAILED_PRECONDITION at node_modules/@grpc/grpc-js/build/src/call.js:32:19 admin@example.com";
  const result = sanitize(stack);
  assert.match(result, /@grpc\/grpc-js\/build\/src\/call\.js:32:19/);
  assert.match(result, /ad\*\*\*@example\.com/);
});

test("filtra y pagina logs estructurados", () => {
  const store = new MetricsStore({startCleanup: false, eventCapacity: 10});
  store.recordStructuredEvent({level: "INFO", module: "tickets", eventType: "CREATED", message: "uno", requestId: "request-1"});
  store.recordStructuredEvent({level: "ERROR", module: "inventory", eventType: "FAILED", message: "dos", requestId: "request-2"});
  const result = store.queryEvents({level: "ERROR", page: 1, pageSize: 1});
  assert.equal(result.pagination.total, 1);
  assert.equal(result.logs[0].eventType, "FAILED");
});

test("calcula estado degradado y metricas por endpoint", () => {
  const store = new MetricsStore({startCleanup: false});
  store.recordRequest({method: "POST", route: "/api/tickets/submit", statusCode: 500, durationMs: 1500});
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.status, "INCIDENT");
  assert.equal(snapshot.endpoints[0].errors, 1);
  assert.equal(snapshot.latencyP95, 1500);
});

test("deduplica alertas durante el periodo configurado", () => {
  const manager = new AlertManager({cooldownMs: 60000, capacity: 10});
  assert.equal(manager.trigger({type: "HTTP_5XX", summary: "fallo", dedupeKey: "same"}), true);
  assert.equal(manager.trigger({type: "HTTP_5XX", summary: "fallo", dedupeKey: "same"}), false);
  assert.equal(manager.list().pagination.total, 1);
});

test("escapa contenido controlado por usuarios en correos HTML", () => {
  const html = buildApprovedEmail({
    ticketId: "<ticket>",
    type: "EXIT",
    area: "<img src=x onerror=alert(1)>",
    approvedBy: "admin@example.com",
    items: [{productId: "<sku>", name: "<script>alert(1)</script>", qty: 1}],
  });
  assert.doesNotMatch(html, /<script>|<img src=x|<ticket>|<sku>/);
  assert.match(html, /&lt;script&gt;/);
});
