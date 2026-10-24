/**
 * Reads the flat weight blob the Python exporter writes.
 *
 * Layout, little-endian float32 throughout, in exactly this order: input mean, input scale, output
 * mean, output scale, then for each layer its weight matrix row-major as `[out, in]` followed by
 * its bias. `tools/train/export.py` writes it and `models/manifest.json` describes it; the parser
 * validates against the manifest rather than assuming, because a silent layout mismatch would
 * produce confident nonsense rather than an error.
 */

import { INPUT_SIZE, OUTPUT_SIZE } from './types'

export interface LayerShape {
  readonly in: number
  readonly out: number
}

export interface WeightManifest {
  readonly format: string
  readonly dtype: string
  readonly activation: string
  readonly layers: readonly LayerShape[]
  readonly floats: number
}

export interface Layer {
  readonly weight: Float32Array
  readonly bias: Float32Array
  readonly in: number
  readonly out: number
}

export interface Weights {
  readonly inputMean: Float32Array
  readonly inputScale: Float32Array
  readonly outputMean: Float32Array
  readonly outputScale: Float32Array
  readonly layers: readonly Layer[]
}

export const SUPPORTED_FORMAT = 'neural-wind-tunnel-surrogate/1'

export function parseWeights(buffer: ArrayBuffer, manifest: WeightManifest): Weights {
  if (manifest.format !== SUPPORTED_FORMAT) {
    throw new Error(`Unsupported weight format: ${manifest.format}`)
  }
  if (manifest.dtype !== 'float32') {
    throw new Error(`Unsupported weight dtype: ${manifest.dtype}`)
  }
  if (manifest.activation !== 'silu') {
    throw new Error(`Unsupported activation: ${manifest.activation}`)
  }

  const floats = new Float32Array(buffer)
  if (floats.length !== manifest.floats) {
    throw new Error(`Blob holds ${floats.length} floats, manifest declares ${manifest.floats}`)
  }

  const first = manifest.layers[0]
  const last = manifest.layers[manifest.layers.length - 1]
  if (first?.in !== INPUT_SIZE || last?.out !== OUTPUT_SIZE) {
    throw new Error(
      `Manifest describes ${first?.in} inputs and ${last?.out} outputs, expected ${INPUT_SIZE} and ${OUTPUT_SIZE}`,
    )
  }

  let offset = 0
  const take = (count: number): Float32Array => {
    const slice = floats.subarray(offset, offset + count)
    if (slice.length !== count) {
      throw new Error(`Blob ran out at offset ${offset}, needed ${count} floats`)
    }
    offset += count
    return slice
  }

  const inputMean = take(INPUT_SIZE)
  const inputScale = take(INPUT_SIZE)
  const outputMean = take(OUTPUT_SIZE)
  const outputScale = take(OUTPUT_SIZE)

  const layers: Layer[] = manifest.layers.map((shape) => ({
    in: shape.in,
    out: shape.out,
    weight: take(shape.out * shape.in),
    bias: take(shape.out),
  }))

  if (offset !== floats.length) {
    throw new Error(`Blob has ${floats.length - offset} floats left over after the manifest`)
  }

  return { inputMean, inputScale, outputMean, outputScale, layers }
}
