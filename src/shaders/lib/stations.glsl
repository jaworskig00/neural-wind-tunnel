// Where a station index lands in the pressure texture.
//
// The index itself arrives interpolated from the mesh, which carries it per vertex; inverting the
// cosine clustering per fragment instead made `acos` of an affinely interpolated chord, and its
// gradient jumps across each quad's diagonal. `src/geometry/stations.ts` has the inverse and the
// story. `docs/DATASET-SCHEMA.md` section 3 is the contract behind both.

const float CP_STATIONS_PER_SURFACE = 64.0;

// A 64 x 2 texture whose rows are the upper and lower surfaces, in the dataset's column order. The
// row coordinate lands exactly on a texel centre, so a linear filter interpolates along the chord
// and never between the two surfaces.
//
// The fractional part is eased rather than used raw. A linear filter reconstructs a piecewise
// linear curve through the 64 samples, which is continuous but has a kink in its gradient at every
// station; seen at a grazing angle, where a whole station compresses into a pixel or two, those
// kinks read as a regular row of bright beads along the silhouette. Feeding the hardware an eased
// fraction turns the same two taps into a smoothstep blend, which is continuous in its gradient
// too. It adds no samples and invents no data: the value at each station is still exactly the
// predicted one, and only the path between neighbours changes.
vec2 pressureTexelCoordinate(float station, float surface) {
  float clamped = clamp(station, 0.0, CP_STATIONS_PER_SURFACE - 1.0);
  float whole = floor(clamped);
  float fraction = clamped - whole;
  float eased = fraction * fraction * (3.0 - 2.0 * fraction);
  float u = (whole + 0.5 + eased) / CP_STATIONS_PER_SURFACE;
  float v = (surface + 0.5) * 0.5;
  return vec2(u, v);
}
