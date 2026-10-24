// Diverging and sequential colormaps, as piecewise-linear interpolation over control points.
//
// Two maps are offered, and the choice is not decorative. `coolwarm` is the convention for pressure
// — blue for suction, red for compression, white at the freestream — and reads instantly to anyone
// who has used a solver. `cividis` is perceptually uniform and distinguishable with any common form
// of colour vision deficiency, which `coolwarm` is not; the UI offers it for that reason.
//
// Control points are sampled from the published definitions of each map. Interpolation is in linear
// sRGB, which is not perceptually ideal but keeps the shader to a handful of instructions and is
// indistinguishable from the real thing at this number of stops.

const int COLORMAP_STOPS = 9;

vec3 colormapCoolwarm(float t) {
  vec3 stops[COLORMAP_STOPS];
  stops[0] = vec3(0.230, 0.299, 0.754);
  stops[1] = vec3(0.406, 0.478, 0.871);
  stops[2] = vec3(0.580, 0.639, 0.945);
  stops[3] = vec3(0.741, 0.769, 0.976);
  stops[4] = vec3(0.866, 0.866, 0.866);
  stops[5] = vec3(0.961, 0.741, 0.671);
  stops[6] = vec3(0.945, 0.580, 0.467);
  stops[7] = vec3(0.871, 0.406, 0.302);
  stops[8] = vec3(0.706, 0.016, 0.150);

  float scaled = clamp(t, 0.0, 1.0) * float(COLORMAP_STOPS - 1);
  int index = int(floor(scaled));
  int next = min(index + 1, COLORMAP_STOPS - 1);
  return mix(stops[index], stops[next], fract(scaled));
}

vec3 colormapCividis(float t) {
  vec3 stops[COLORMAP_STOPS];
  stops[0] = vec3(0.000, 0.135, 0.304);
  stops[1] = vec3(0.000, 0.208, 0.403);
  stops[2] = vec3(0.145, 0.282, 0.437);
  stops[3] = vec3(0.290, 0.355, 0.455);
  stops[4] = vec3(0.420, 0.431, 0.467);
  stops[5] = vec3(0.561, 0.514, 0.439);
  stops[6] = vec3(0.710, 0.604, 0.373);
  stops[7] = vec3(0.871, 0.702, 0.278);
  stops[8] = vec3(0.996, 0.839, 0.161);

  float scaled = clamp(t, 0.0, 1.0) * float(COLORMAP_STOPS - 1);
  int index = int(floor(scaled));
  int next = min(index + 1, COLORMAP_STOPS - 1);
  return mix(stops[index], stops[next], fract(scaled));
}
