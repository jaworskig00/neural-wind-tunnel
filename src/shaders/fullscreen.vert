// Vertex stage shared by every full-screen pass: reconstruction, particle update, mask.
//
// The quad is drawn straight in clip space, so no camera and no model matrix are involved, and it
// deliberately passes nothing to the fragment stage. Texel coordinates are derived there from
// `gl_FragCoord` and the target resolution instead of from a `uv` varying.
//
// That is not a stylistic preference. Relying on the `uv` attribute cost an afternoon: it arrived at
// the fragment stage as a constant, every texel of a 512 by 512 position texture hashed to the same
// value, and a million particles were seeded onto a single point. `gl_FragCoord` is supplied by the
// rasteriser and cannot be absent, mis-declared, or dropped by a material's attribute handling.

void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
