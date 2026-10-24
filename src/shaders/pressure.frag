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

  // A diverging map has to diverge about something meaningful, and that is Cp = 0 -- the freestream
  // pressure -- not the midpoint of the chosen range. Mapping linearly over [-4, 1] instead puts the
  // neutral colour at Cp = -1.5, which is inside the ordinary working range of these sections, so a
  // typical distribution came out uniformly warm and read as a solid colour rather than as data.
  // Suction below zero runs to the cool end, compression above it to the warm end, freestream white.
  float diverging = cp < 0.0
      ? 0.5 * (1.0 - clamp(cp / uPressureMin, 0.0, 1.0))
      : 0.5 + 0.5 * clamp(cp / uPressureMax, 0.0, 1.0);

  // Cividis is sequential, so it gets a plain linear map over the range; forcing a midpoint on it
  // would imply a divergence the colormap cannot express.
  float sequential = clamp((cp - uPressureMin) / max(uPressureMax - uPressureMin, 1e-5), 0.0, 1.0);

  vec3 colour = uColormap == 1 ? colormapCividis(sequential) : colormapCoolwarm(diverging);

  vec3 normal = normalize(vNormal);
  vec3 viewDirection = normalize(vViewPosition);
  float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
  // A gentle rim term, nothing more: enough to separate the two surfaces at a glancing angle.
  float shading = mix(1.0, 0.55 + 0.45 * facing, uShadingStrength);

  gl_FragColor = vec4(colour * shading, 1.0);
}
