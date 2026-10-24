// Hashes that survive float32.
//
// The obvious `fract(sin(dot(p, k)) * 43758.5453)` is everywhere, and it breaks here. Multiplying by
// 43758 pushes the value to around 1e7, where a 32-bit float has a resolution of about 2 -- so
// `fract` of it quantises to a handful of values and neighbouring texels come out bit-identical.
// That is not a subtle loss of quality: a million particles were seeded onto a handful of positions
// and the field looked like static instead of flow.
//
// These are Dave Hoskins' hashes, which stay inside a well-conditioned range throughout.

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
