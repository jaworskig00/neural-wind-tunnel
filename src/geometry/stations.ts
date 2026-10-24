/**
 * Surface station grid for the pressure distribution.
 *
 * These values are a contract, not an implementation detail: the dataset's `cp_000` ... `cp_127`
 * columns are sampled at exactly these stations, and the surrogate predicts them in the same
 * order. See `docs/DATASET-SCHEMA.md` section 3. Changing anything here without bumping the
 * schema version silently misaligns every pressure plot.
 *
 *     psi_j = 0.5 * (1 - cos(pi * j / (N - 1)))    for j = 0 .. N-1
 *
 * The cosine clustering concentrates stations at the leading and trailing edges, where the
 * pressure gradient is steepest.
 */

/** Stations per surface. */
export const CP_STATIONS_PER_SURFACE = 64

/** Total station count across both surfaces, matching the `cp_*` column count. */
export const CP_STATION_COUNT = CP_STATIONS_PER_SURFACE * 2

export type Surface = 'upper' | 'lower'

/**
 * Chordwise positions `x/c` of the stations on one surface, leading edge first.
 * Identical for both surfaces.
 */
export function cpStations(): Float64Array {
  const stations = new Float64Array(CP_STATIONS_PER_SURFACE)
  const last = CP_STATIONS_PER_SURFACE - 1
  for (let j = 0; j <= last; j += 1) {
    stations[j] = 0.5 * (1 - Math.cos((Math.PI * j) / last))
  }
  return stations
}

/**
 * Maps a flat `cp_*` column index to its surface and chordwise position.
 * Indices 0..63 are the upper surface, 64..127 the lower, each leading edge to trailing edge.
 */
export function cpStationAt(index: number): { surface: Surface; x: number } {
  if (!Number.isInteger(index) || index < 0 || index >= CP_STATION_COUNT) {
    throw new RangeError(`Station index ${index} is outside 0..${CP_STATION_COUNT - 1}`)
  }
  const surface: Surface = index < CP_STATIONS_PER_SURFACE ? 'upper' : 'lower'
  const j = index % CP_STATIONS_PER_SURFACE
  const last = CP_STATIONS_PER_SURFACE - 1
  return { surface, x: 0.5 * (1 - Math.cos((Math.PI * j) / last)) }
}
