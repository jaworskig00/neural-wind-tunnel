// Particle rendering, vertex stage.
//
// One vertex per particle, its position read from the simulation texture rather than from a vertex
// attribute: the attribute only carries which texel to look in. That is the whole point of the
// GPGPU arrangement -- positions never make the trip back to the CPU.

precision highp float;

uniform sampler2D uPositions;
uniform sampler2D uVelocity;
uniform float uPointSize;
uniform float uMaxAge;
uniform vec2 uDomainMin;
uniform vec2 uDomainMax;

attribute vec2 aIndex;

varying float vSpeed;
varying float vFade;

void main() {
  vec4 state = texture2D(uPositions, aIndex);
  vec2 position = state.xy;

  vec2 fieldUv = (position - uDomainMin) / (uDomainMax - uDomainMin);
  vSpeed = length(texture2D(uVelocity, fieldUv).rg);

  // Fade in on birth and out on death, so respawning never pops.
  float age = state.z;
  vFade = smoothstep(0.0, 0.08 * uMaxAge, age) * (1.0 - smoothstep(0.75 * uMaxAge, uMaxAge, age));

  vec4 viewPosition = modelViewMatrix * vec4(position, 0.0, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  // Perspective-correct sizing, clamped so a particle near the camera cannot become a blob.
  gl_PointSize = clamp(uPointSize / -viewPosition.z, 0.7, 6.0);
}
