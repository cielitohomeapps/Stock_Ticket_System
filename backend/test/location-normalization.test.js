const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findCanonicalLocation,
  canonicalizeLocationName,
  normalizeLocationAliases,
  assertLocationTermsAvailable,
} = require("../src/services/location-normalization");

const locations = [
  {id: "sucursal-centro", name: "Sucursal Centro", aliases: ["Centro", "Suc. Centro"]},
  {id: "bodega-norte", name: "Bodega Norte", aliases: ["Almacén Norte"]},
];

test("resuelve nombres y alias ignorando acentos, mayúsculas y espacios", () => {
  assert.deepEqual(
      findCanonicalLocation("  ALMACEN   NORTE ", locations),
      {status: "matched", location: locations[1]},
  );
});

test("analytics puede normalizar aliases históricos al nombre canónico", () => {
  assert.equal(canonicalizeLocationName("suc. CENTRO", locations), "Sucursal Centro");
});

test("conserva valores históricos no registrados sin asignarlos a otra ubicación", () => {
  assert.equal(canonicalizeLocationName("Sucursal Sur", locations), "Sucursal Sur");
});

test("normaliza aliases para evitar variantes duplicadas dentro de una ubicación", () => {
  assert.deepEqual(
      normalizeLocationAliases("Jesús María", [" JESUS MARIA ", "JM", "jm"]),
      ["JM"],
  );
});

test("rechaza un nombre o alias que ya pertenece a otra ubicación", () => {
  assert.throws(
      () => assertLocationTermsAvailable(
          {name: "Nueva sucursal", aliases: ["Centro"]},
          locations,
      ),
      (error) => error.code === "LOCATION_ALIAS_CONFLICT" && error.statusCode === 409,
  );
});

test("reporta conflictos históricos de alias sin elegir un destino arbitrario", () => {
  const ambiguousLocations = [
    ...locations,
    {id: "otra-sucursal", name: "Otra sucursal", aliases: ["Centro"]},
  ];
  assert.deepEqual(
      findCanonicalLocation("CENTRO", ambiguousLocations),
      {status: "ambiguous", location: null},
  );
  assert.equal(canonicalizeLocationName("Centro", ambiguousLocations), "Centro");
});
