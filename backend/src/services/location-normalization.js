function normalizeLocationName(value) {
  return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
}

function getLocationTerms(location) {
  return [location?.name, ...(Array.isArray(location?.aliases) ? location.aliases : [])]
      .map(normalizeLocationName)
      .filter(Boolean);
}

function findCanonicalLocation(value, locations) {
  const normalized = normalizeLocationName(value);
  if (!normalized) return {status: "empty", location: null};

  const matches = locations.filter((location) => getLocationTerms(location).includes(normalized));
  const uniqueMatches = [...new Map(matches.map((location) => [
    location.id || normalizeLocationName(location.name),
    location,
  ])).values()];
  if (uniqueMatches.length > 1) return {status: "ambiguous", location: null};
  if (uniqueMatches.length === 1) return {status: "matched", location: uniqueMatches[0]};
  return {status: "not-found", location: null};
}

function canonicalizeLocationName(value, locations) {
  const raw = String(value || "").trim();
  const match = findCanonicalLocation(raw, locations);
  return match.status === "matched" ? match.location.name : raw;
}

function normalizeLocationAliases(name, aliases) {
  const unique = new Map();
  const canonicalName = normalizeLocationName(name);
  if (canonicalName) unique.set(canonicalName, String(name).trim());
  for (const value of (Array.isArray(aliases) ? aliases : [aliases])) {
    const alias = String(value || "").trim();
    const normalized = normalizeLocationName(alias);
    if (alias && normalized && !unique.has(normalized)) unique.set(normalized, alias);
  }
  return [...unique.entries()]
      .filter(([normalized]) => normalized !== canonicalName)
      .map(([, alias]) => alias);
}

function assertLocationTermsAvailable(location, locations, excludedId = null) {
  const terms = getLocationTerms(location);
  for (const existing of locations) {
    if (existing.id === excludedId) continue;
    const existingTerms = new Set(getLocationTerms(existing));
    const duplicate = terms.find((term) => existingTerms.has(term));
    if (duplicate) {
      const error = new Error(`El nombre o alias "${duplicate}" ya pertenece a otra ubicación.`);
      error.statusCode = 409;
      error.code = "LOCATION_ALIAS_CONFLICT";
      throw error;
    }
  }
}

module.exports = {
  normalizeLocationName,
  findCanonicalLocation,
  canonicalizeLocationName,
  normalizeLocationAliases,
  assertLocationTermsAvailable,
};
