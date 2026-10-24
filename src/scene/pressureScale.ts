/**
 * The pressure colour scale, kept free of any renderer import.
 *
 * The legend needs these numbers and the material needs them too. Exporting them from the material
 * meant the legend imported `three` transitively, which put the whole renderer into the entry
 * bundle: 186 kB gzip against a 100 kB budget. A constant does not need a graphics library.
 */

/**
 * Fixed range for the colour scale.
 *
 * Fixed, not auto-scaled: a scale that rescales itself as the shape changes makes two states
 * impossible to compare, which defeats the purpose of the app. Anything beyond it clamps.
 *
 * The suction floor is chosen from the dataset rather than picked as a round number. Across the
 * converged rows the median suction peak is -1.43 and the lower quartile -2.28, so a floor of -2.5
 * keeps the typical distribution well inside the scale while clamping only 1.0 % of all station
 * values. The first attempt used -4, which clamps less but puts the median peak barely a fifth of
 * the way along the scale: the surface came out almost uniformly pale and read as a solid colour
 * rather than as data.
 */
export const PRESSURE_RANGE = { min: -2.5, max: 1 } as const

export type ColormapName = 'coolwarm' | 'cividis'

export const COLORMAP_INDEX: Readonly<Record<ColormapName, number>> = { coolwarm: 0, cividis: 1 }
