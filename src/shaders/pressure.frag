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
varying float vIsSurface;
varying float vStation;
varying vec3 vNormal;
varying vec3 vViewPosition;

float sampleCp(float station, float surface) {
  return texture2D(uPressure, pressureTexelCoordinate(station, surface)).r;
}

void main() {
  float cp = sampleCp(vStation, vSurface);

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

  /**
   * The span-wise cut is the body, tinted by its own surface pressure -- not a field.
   *
   * The cut is a ladder between the two surfaces at matching chord, so a fragment in the middle of
   * the section sits between the upper and lower values at that chord and reads as a blend of the
   * two. That is an interpolation between two computed boundary values, not a solution anywhere
   * inside the body, and nothing was solved in there. It is drawn darker and partly desaturated so
   * the wall -- where the pressure was actually computed -- is always the brighter, more saturated
   * surface of the two, and the eye goes to the data first.
   *
   * It used to be a triangle fan from mid-chord, which collapsed the chordwise coordinate to 0.5
   * at the centre and painted a fan of contour bands radiating from a point with no meaning.
   */
  float grey = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  vec3 cutColour = mix(vec3(grey), colour, 0.7) * (0.74 + 0.14 * facing);
  vec3 shaded = mix(cutColour, colour * shading, step(0.5, vIsSurface));

  gl_FragColor = vec4(shaded, 1.0);
}
