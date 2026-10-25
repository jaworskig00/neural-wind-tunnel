// Pressure-mapped surface, vertex stage.
//
// Carries two things to the fragment stage: the chordwise position, which indexes the pressure
// array, and which surface this vertex belongs to. Both come from mesh attributes rather than being
// derived from the position, because the section is rotated by incidence and the chordwise axis is
// no longer the world x axis.

attribute float aSurface;
attribute float aIsSurface;
attribute float aStation;

varying float vChord;
varying float vSurface;
varying float vIsSurface;
varying float vStation;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vChord = uv.x;
  vSurface = aSurface;
  vIsSurface = aIsSurface;
  vStation = aStation;
  vNormal = normalize(normalMatrix * normal);

  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -viewPosition.xyz;
  gl_Position = projectionMatrix * viewPosition;
}
