// Particle advection: one texel is one particle's position.
//
// Second-order Runge-Kutta rather than forward Euler. The cost is one extra field sample and the
// benefit is visible: under Euler a particle rounding the leading edge cuts the corner and drifts
// into the body, which no amount of masking makes look right.
//
// Three things end a particle's life, and all three respawn it at the inlet rather than deleting it,
// so the particle count stays exactly what the tier promised:
//   * leaving the sampled domain, which is where the field stops being known;
//   * entering the body, tested against a mask rendered from the section itself;
//   * reaching its maximum age, which keeps the distribution from collapsing into the wake.

#include <hash>

precision highp float;

uniform sampler2D uPositions;
uniform sampler2D uVelocity;
uniform sampler2D uBodyMask;
uniform float uDeltaTime;
uniform float uTime;
uniform float uSpeed;
uniform float uMaxAge;
uniform vec2 uDomainMin;
uniform vec2 uDomainMax;
uniform vec2 uResolution;
uniform bool uSeeding;

// Field position to texture coordinate.
vec2 toFieldUv(vec2 position) {
  return (position - uDomainMin) / (uDomainMax - uDomainMin);
}

vec2 sampleVelocity(vec2 position) {
  return texture2D(uVelocity, toFieldUv(position)).rg;
}

bool insideBody(vec2 position) {
  return texture2D(uBodyMask, toFieldUv(position)).r > 0.5;
}

// Respawn at the inlet.
//
// `seed` must be the integer texel coordinate, not the normalised one. Neighbouring texels of a 512
// by 512 texture differ by 1/512 in normalised coordinates, and every hash in common use returns
// nearly-equal outputs for nearly-equal inputs that small -- a million particles then land on one
// point and the field renders as a smear. Feeding it 0..511 separates them properly.
vec4 respawn(vec2 seed) {
  // Seeded across the inlet face, with a little spread in x so the curtain does not read as a line.
  // The age is randomised too, otherwise every particle respawned in the same frame dies in the same
  // frame and the field pulses.
  vec2 scatter = hash22(seed);
  float y = mix(uDomainMin.y, uDomainMax.y, scatter.x);
  float x = uDomainMin.x + 0.25 * (uDomainMax.x - uDomainMin.x) * scatter.y;
  return vec4(x, y, hash12(seed + 17.0) * uMaxAge, 1.0);
}

void main() {
  vec2 vUv = gl_FragCoord.xy / uResolution;


  vec4 state = texture2D(uPositions, vUv);
  vec2 position = state.xy;
  float age = state.z;

  // The simulation is seeded by an explicit pass rather than by reading whatever a cleared target
  // happens to contain. Relying on the cleared alpha being zero cost an afternoon: the renderer
  // clears to an opaque colour, so the "needs a starting position" test never fired and every one
  // of a quarter of a million particles started life at the origin and advected as a single point.
  if (uSeeding) {
    gl_FragColor = respawn(gl_FragCoord.xy);
    return;
  }

  float step = uDeltaTime * uSpeed;
  vec2 first = sampleVelocity(position);
  vec2 midpoint = position + 0.5 * step * first;
  vec2 second = sampleVelocity(midpoint);
  vec2 advanced = position + step * second;

  age += uDeltaTime;

  bool escaped =
      advanced.x < uDomainMin.x || advanced.x > uDomainMax.x ||
      advanced.y < uDomainMin.y || advanced.y > uDomainMax.y;

  if (escaped || age > uMaxAge || insideBody(advanced)) {
    gl_FragColor = respawn(gl_FragCoord.xy + fract(uTime * 0.37));
    return;
  }

  gl_FragColor = vec4(advanced, age, 1.0);
}
