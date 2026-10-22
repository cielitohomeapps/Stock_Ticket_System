const {createHash} = require("crypto");

function createIdempotencyDocumentId(userId, key) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("userId is required to create an idempotency document ID.");
  }
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    const error = new Error("Idempotency-Key debe contener entre 8 y 128 caracteres válidos.");
    error.statusCode = 400;
    error.code = "INVALID_IDEMPOTENCY_KEY";
    throw error;
  }
  return createHash("sha256").update(`${userId}\0${key}`).digest("hex");
}

function createSubmissionFingerprint(userId, normalizedPayload) {
  return createHash("sha256")
      .update(JSON.stringify({requestedBy: userId, ...normalizedPayload}))
      .digest("hex");
}

module.exports = {
  createIdempotencyDocumentId,
  createSubmissionFingerprint,
};
