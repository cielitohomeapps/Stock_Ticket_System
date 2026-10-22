const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createIdempotencyDocumentId,
  createSubmissionFingerprint,
} = require("../src/services/idempotency.service");

test("la misma clave del mismo usuario produce el mismo identificador", () => {
  const first = createIdempotencyDocumentId("user-1", "request-key-123");
  const second = createIdempotencyDocumentId("user-1", "request-key-123");
  assert.equal(first, second);
});

test("las claves de usuarios distintos quedan aisladas", () => {
  assert.notEqual(
      createIdempotencyDocumentId("user-1", "request-key-123"),
      createIdempotencyDocumentId("user-2", "request-key-123"),
  );
});

test("rechaza claves faltantes o con formato inválido", () => {
  assert.throws(
      () => createIdempotencyDocumentId("user-1", "bad key"),
      (error) => error.code === "INVALID_IDEMPOTENCY_KEY" && error.statusCode === 400,
  );
});

test("el fingerprint cambia si los datos normalizados cambian", () => {
  const payload = {type: "EXIT", items: [{productId: "A", qty: 1}]};
  assert.equal(
      createSubmissionFingerprint("user-1", payload),
      createSubmissionFingerprint("user-1", payload),
  );
  assert.notEqual(
      createSubmissionFingerprint("user-1", payload),
      createSubmissionFingerprint("user-1", {...payload, items: [{productId: "A", qty: 2}]}),
  );
});
