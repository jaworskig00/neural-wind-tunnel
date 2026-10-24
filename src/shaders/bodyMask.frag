// The body mask: one inside the section, zero outside.
//
// Drawn from the section's own triangles rather than tested analytically, because the section is a
// polygon and the rasteriser is already very good at filling polygons. Rebuilt whenever the shape
// changes, which is cheaper than it sounds -- 160 triangles into a 192 x 96 target.

precision highp float;

void main() {
  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
