const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TicketValidationError,
  normalizeTicketPayload,
  evaluateTicketIntegrity,
  canAccessTicket,
  normalizeStockReconciliationDecision,
} = require("../src/services/ticket-integrity.service");

const validPayload = {
  type: "exit",
  items: [{productId: " SKU-1 ", name: "Lampara", qty: "2"}],
  assignedUsers: ["ops@example.com", "ops@example.com"],
  metadata: {
    area: "Bodega",
    motivo: "Traslado",
    firma: "Responsable",
    destino: "Sucursal Norte",
    fecha: "2026-10-22",
  },
};

test("normaliza y conserva todos los campos obligatorios del ticket", () => {
  const ticket = normalizeTicketPayload(validPayload);
  assert.equal(ticket.type, "EXIT");
  assert.deepEqual(ticket.items, [{productId: "SKU-1", name: "Lampara", qty: 2}]);
  assert.deepEqual(ticket.metadata, validPayload.metadata);
  assert.deepEqual(ticket.assignedUsers, ["ops@example.com"]);
});

test("rechaza tickets incompletos y cantidades no enteras", () => {
  assert.throws(
      () => normalizeTicketPayload({type: "EXIT", items: [{productId: "A", qty: 1.5}], metadata: {}}),
      (error) => error instanceof TicketValidationError && error.details.length >= 5,
  );
});

test("rechaza productos duplicados para evitar escrituras ambiguas", () => {
  assert.throws(
      () => normalizeTicketPayload({...validPayload, items: [{productId: "A", qty: 1}, {productId: "A", qty: 2}]}),
      /incompleto/i,
  );
});

test("detecta un ticket marcado enviado que quedo en CREADO", () => {
  const result = evaluateTicketIntegrity({
    ...normalizeTicketPayload(validPayload),
    requestedBy: "user-1",
    status: "CREADO",
    submissionState: "SUBMITTED",
    createdAt: "2026-10-22T12:00:00.000Z",
  });
  assert.equal(result.complete, false);
  assert.match(result.issues.join(" "), /permanece en CREADO/);
});

test("detecta un resultado incierto del sistema de inventarios", () => {
  const result = evaluateTicketIntegrity({
    ...normalizeTicketPayload(validPayload),
    requestedBy: "user-1",
    status: "EN_REVISION",
    reviewSentAt: "2026-10-22T12:00:00.000Z",
    createdAt: "2026-10-22T12:00:00.000Z",
    stockSyncStatus: "UNKNOWN",
  });
  assert.equal(result.complete, false);
  assert.match(result.issues.join(" "), /conciliacion manual/);
});

test("autoriza el detalle solo al propietario o a un administrador", () => {
  const ticket = {requestedBy: "owner"};
  assert.equal(canAccessTicket(ticket, {id: "owner", esAdminLevel: false}), true);
  assert.equal(canAccessTicket(ticket, {id: "other", esAdminLevel: false}), false);
  assert.equal(canAccessTicket(ticket, {id: "admin", esAdminLevel: true}), true);
});

test("valida y normaliza la decisión administrativa de conciliación", () => {
  assert.deepEqual(
      normalizeStockReconciliationDecision({decision: " applied ", reason: " Verificado en inventario "}),
      {decision: "APPLIED", reason: "Verificado en inventario"},
  );
  assert.throws(
      () => normalizeStockReconciliationDecision({decision: "RETRY", reason: ""}),
      (error) => error.code === "INVALID_STOCK_RECONCILIATION" && error.statusCode === 400,
  );
});
