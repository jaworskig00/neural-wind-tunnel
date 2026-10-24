// Pressure-mapped surface, fragment stage.
//
// Samples the predicted pressure coefficient at this fragment's chordwise station, maps it through
// the selected colormap, and applies a restrained amount of shading so the form still reads as a
// solid. The shading is deliberately weak: the colour carries data and must not be confused with a
// lighting gradient.

#include <colormap>
#include <stations>

uniform sampler2D uPressure;
uniform float uPressureMin;
uniform float uPressureMax;
uniform int uColormap;
uniform float uShadingStrength;

varying float vChord;
varying float vSurface;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  float coordinate = pressureTexelCoordinate(vChord, vSurface);
  float cp = texture2D(uPressure, vec2(coordinate, 0.5)).r;

  // Normalised with the suction end at 0 so the colormap's cool end means low pressure, which is the
  // convention a reader expects.
  float t = clamp((uPressureMax - cp) / max(uPressureMax - uPressureMin, 1e-5), 0.0, 1.0);
  vec3 colour = uColormap == 1 ? colormapCividis(t) : colormapCoolwarm(1.0 - t);

  vec3 normal = normalize(vNormal);
  vec3 viewDirection = normalize(vViewPosition);
  float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
  // A gentle rim term, nothing more: enough to separate the two surfaces at a glancing angle.
  float shading = mix(1.0, 0.55 + 0.45 * facing, uShadingStrength);

  gl_FragColor = vec4(colour * shading, 1.0);
}
