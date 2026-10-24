// Maps a chordwise position to its index in the 128-entry pressure array.
//
// The dataset's stations are cosine-clustered, `psi_j = (1 - cos(pi j / 63)) / 2`, so recovering the
// index from a position means inverting that: `j = 63 * acos(1 - 2 psi) / pi`. Doing it here rather
// than passing an index per vertex keeps the mesh attributes to what the geometry needs, and the
// inverse is exact — no lookup table, no interpolation error.
//
// `docs/DATASET-SCHEMA.md` section 3 is the contract this implements.

const float CP_STATIONS_PER_SURFACE = 64.0;

float stationIndexFromChord(float chord) {
  float clamped = clamp(chord, 0.0, 1.0);
  return (CP_STATIONS_PER_SURFACE - 1.0) * acos(clamp(1.0 - 2.0 * clamped, -1.0, 1.0)) / 3.14159265359;
}

// Texture coordinate for a chordwise position on one surface. `surface` is 0 for upper, 1 for lower,
// matching the column order in the dataset.
float pressureTexelCoordinate(float chord, float surface) {
  float index = surface * CP_STATIONS_PER_SURFACE + stationIndexFromChord(chord);
  return (index + 0.5) / (2.0 * CP_STATIONS_PER_SURFACE);
}
