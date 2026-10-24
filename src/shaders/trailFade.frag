// Trail decay.
//
// What turns a cloud of dots into flow. A snapshot of a million uniformly distributed points reads
// as static no matter how fast they are moving; what the eye reads as motion is the path each one
// has taken. So the particles are drawn into an accumulation target that is faded rather than
// cleared, and every particle leaves a streak that decays behind it.
//
// The decay is per-second rather than per-frame, so a trail looks the same at 30 fps as at 120.

precision highp float;

uniform sampler2D uPrevious;
uniform float uDecay;
uniform float uDeltaTime;
uniform vec2 uResolution;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec4 previous = texture2D(uPrevious, uv);
  float keep = exp(-uDecay * uDeltaTime);
  // A floor subtracted alongside the exponential, so a faint trail reaches exactly zero instead of
  // lingering as a permanent smudge that slowly saturates the buffer.
  gl_FragColor = max(previous * keep - 0.004 * uDeltaTime * 60.0, vec4(0.0));
}
