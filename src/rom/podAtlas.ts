/**
 * Loads the reduced-order basis the browser rebuilds the velocity field from.
 *
 * The file is the mean perturbation field followed by each mode, float16, each laid out as every
 * `u` over the grid and then every `v`, row-major with `y` outermost -- exactly as
 * `tools/dataset/pod.py` writes it and `docs/DATASET-SCHEMA.md` section 4 declares it.
 *
 * It is uploaded as one array texture with a layer per mode and `u, v` in the red and green
 * channels, which is what lets the reconstruction shader loop over modes without 33 separate
 * samplers.
 */

import { DataArrayTexture, HalfFloatType, LinearFilter, NearestFilter, RGFormat } from 'three'

/** Grid declared in `docs/DATASET-SCHEMA.md` section 4. */
export const FIELD_WIDTH = 192
export const FIELD_HEIGHT = 96
export const FIELD_X_RANGE = [-1, 2] as const
export const FIELD_Y_RANGE = [-0.75, 0.75] as const

/** Modes the surrogate predicts coefficients for. */
export const MODE_COUNT = 32

const PIXELS = FIELD_WIDTH * FIELD_HEIGHT
const FLOATS_PER_LAYER = 2 * PIXELS
const LAYERS = MODE_COUNT + 1

export interface PodAtlas {
  /** Layer 0 is the mean field; layers 1..32 are the modes. */
  readonly texture: DataArrayTexture
  readonly layers: number
  dispose: () => void
}

/**
 * Rearranges the flat file into the interleaved layout a texture needs.
 *
 * The file stores `u` and `v` as separate planes per layer; a two-channel texture wants them side
 * by side per texel. Done once at load, not per frame.
 */
export function interleave(raw: Uint16Array): Uint16Array {
  if (raw.length !== LAYERS * FLOATS_PER_LAYER) {
    throw new Error(
      `Atlas has ${raw.length} half-floats, expected ${LAYERS * FLOATS_PER_LAYER} ` +
        `(${LAYERS} layers of ${FIELD_WIDTH}x${FIELD_HEIGHT} with two components)`,
    )
  }

  const interleaved = new Uint16Array(raw.length)
  for (let layer = 0; layer < LAYERS; layer += 1) {
    const source = layer * FLOATS_PER_LAYER
    const target = layer * FLOATS_PER_LAYER
    for (let pixel = 0; pixel < PIXELS; pixel += 1) {
      interleaved[target + 2 * pixel] = raw[source + pixel]!
      interleaved[target + 2 * pixel + 1] = raw[source + PIXELS + pixel]!
    }
  }
  return interleaved
}

export function createAtlas(raw: Uint16Array, linearFiltering: boolean): PodAtlas {
  const texture = new DataArrayTexture(interleave(raw), FIELD_WIDTH, FIELD_HEIGHT, LAYERS)
  texture.format = RGFormat
  texture.type = HalfFloatType
  // Linear where the hardware allows it: the field is smooth and a 192-wide grid stretched across
  // the viewport shows its texels otherwise.
  texture.minFilter = linearFiltering ? LinearFilter : NearestFilter
  texture.magFilter = linearFiltering ? LinearFilter : NearestFilter
  texture.needsUpdate = true

  return {
    texture,
    layers: LAYERS,
    dispose: () => {
      texture.dispose()
    },
  }
}

export async function loadPodAtlas(url: string, linearFiltering: boolean): Promise<PodAtlas> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not fetch the mode atlas: ${response.status}`)
  }
  const buffer = await response.arrayBuffer()
  return createAtlas(new Uint16Array(buffer), linearFiltering)
}
