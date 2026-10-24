// Reduced-order reconstruction: rebuilds the velocity field from the surrogate's modal coefficients.
//
// This is the pass the whole project turns on. The network predicts 32 numbers; this shader turns
// them back into a velocity field:
//
//     perturbation = mean + sum_i a_i * phi_i
//     velocity     = freestream + perturbation
//
// One texture fetch per mode per texel, 33 fetches over a 192 x 96 target -- about 600 000 fetches,
// which is nothing, and it runs only when the prediction changes rather than every frame.
//
// The freestream is added here rather than being learnt, because incidence enters it analytically:
// the stored fields are perturbations with the freestream removed (see ADR-007 and
// tools/dataset/run.py). The output is in the section frame, where the body is axis-aligned and the
// flow arrives at the angle of attack.

precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uModes;
uniform float uCoefficients[MODE_COUNT];
uniform float uAlphaRadians;
uniform vec2 uResolution;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  // Layer 0 is the mean perturbation field; the modes follow it.
  vec2 perturbation = texture(uModes, vec3(uv, 0.0)).rg;

  for (int i = 0; i < MODE_COUNT; i++) {
    perturbation += uCoefficients[i] * texture(uModes, vec3(uv, float(i + 1))).rg;
  }

  vec2 freestream = vec2(cos(uAlphaRadians), sin(uAlphaRadians));
  gl_FragColor = vec4(freestream + perturbation, 0.0, 1.0);
}
