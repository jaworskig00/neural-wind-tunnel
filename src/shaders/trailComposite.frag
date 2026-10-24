// Draws the accumulated trails over the scene.
//
// Additive, because the trails are light in a dark tunnel: where many particles have passed the
// image brightens, and where none have it leaves the scene untouched.

precision highp float;

uniform sampler2D uTrails;
uniform float uIntensity;
uniform vec2 uResolution;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec4 trails = texture2D(uTrails, uv);
  vec3 exposed = 1.0 - exp(-trails.rgb * uIntensity);
  gl_FragColor = vec4(exposed, 1.0);
}
