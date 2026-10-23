const EMAIL_PATTERN = /^[^\s@<>(),;:\\"\[\]]+@[^\s@<>(),;:\\"\[\]]+\.[^\s@<>(),;:\\"\[\]]+$/;

function normalizeEmailAddresses(values, {field = "emails", max = 50} = {}) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) {
    throw new Error(`${field} debe ser una lista.`);
  }
  if (values.length > max) {
    throw new Error(`${field} no puede contener más de ${max} direcciones.`);
  }

  const normalized = [...new Set(values.map((value) => String(value || "").trim().toLowerCase()))];
  for (const email of normalized) {
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      throw new Error(`${field} contiene una dirección inválida.`);
    }
  }
  return normalized;
}

function normalizeOptionalText(value, {field, max}) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${field} debe ser texto.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${field} no puede exceder ${max} caracteres.`);
  return normalized;
}

module.exports = {
  normalizeEmailAddresses,
  normalizeOptionalText,
};
