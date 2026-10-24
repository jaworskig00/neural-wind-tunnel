// Particle rendering, fragment stage.
//
// Additive, coloured by local speed through the same colormap family the surface uses, so the two
// readings of the flow agree with each other. Points are drawn as soft discs rather than squares;
// a million hard-edged squares reads as noise.

#include <colormap>

precision highp float;

uniform float uSpeedMin;
uniform float uSpeedMax;
uniform float uOpacity;
uniform int uColormap;

varying float vSpeed;
varying float vFade;

void main() {
  vec2 offset = gl_PointCoord - vec2(0.5);
  float radius = length(offset);
  if (radius > 0.5) discard;

  float t = clamp((vSpeed - uSpeedMin) / max(uSpeedMax - uSpeedMin, 1e-5), 0.0, 1.0);
  vec3 colour = uColormap == 1 ? colormapCividis(t) : colormapCoolwarm(t);

  float softness = 1.0 - smoothstep(0.25, 0.5, radius);
  gl_FragColor = vec4(colour, uOpacity * vFade * softness);
}
