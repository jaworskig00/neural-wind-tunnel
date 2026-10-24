import { describe, expect, it } from 'vitest'

import { TypeScriptBackend } from './typescriptBackend'
import { INPUT_SIZE, OUTPUT_SIZE, toInput, toPrediction } from './types'
import { SUPPORTED_FORMAT, type WeightManifest, parseWeights } from './weights'

/**
 * A two-layer model small enough to work out by hand, so the forward pass is checked against
 * arithmetic rather than against itself. The real parity check against the trained model and the
 * ONNX runtime lives in `tests/e2e`.
 */
function toyWeights(): { buffer: ArrayBuffer; manifest: WeightManifest } {
  const hidden = 4
  const layers = [
    { in: INPUT_SIZE, out: hidden },
    { in: hidden, out: OUTPUT_SIZE },
  ]
  const floats =
    2 * INPUT_SIZE +
    2 * OUTPUT_SIZE +
    layers.reduce((total, layer) => total + layer.out * layer.in + layer.out, 0)

  const blob = new Float32Array(floats)
  let offset = 0
  blob.fill(0, offset, offset + INPUT_SIZE) // input mean
  offset += INPUT_SIZE
  blob.fill(1, offset, offset + INPUT_SIZE) // input scale
  offset += INPUT_SIZE
  blob.fill(0, offset, offset + OUTPUT_SIZE) // output mean
  offset += OUTPUT_SIZE
  blob.fill(1, offset, offset + OUTPUT_SIZE) // output scale
  offset += OUTPUT_SIZE

  // First layer: every hidden unit sums the inputs, with no bias.
  blob.fill(1, offset, offset + hidden * INPUT_SIZE)
  offset += hidden * INPUT_SIZE
  blob.fill(0, offset, offset + hidden)
  offset += hidden
  // Second layer: every output takes the first hidden unit only, plus a bias of 0.5.
  for (let row = 0; row < OUTPUT_SIZE; row += 1) {
    blob[offset + row * hidden] = 1
  }
  offset += OUTPUT_SIZE * hidden
  blob.fill(0.5, offset, offset + OUTPUT_SIZE)

  return {
    buffer: blob.buffer,
    manifest: {
      format: SUPPORTED_FORMAT,
      dtype: 'float32',
      activation: 'silu',
      layers,
      floats,
    },
  }
}

function backend(): TypeScriptBackend {
  const { buffer, manifest } = toyWeights()
  return new TypeScriptBackend(parseWeights(buffer, manifest))
}

const silu = (x: number): number => x / (1 + Math.exp(-x))

describe('TypeScriptBackend', () => {
  it('reproduces the forward pass by hand', () => {
    const input = new Float32Array(INPUT_SIZE).fill(0.1)
    // Hidden units each see the sum of the inputs, then SiLU; outputs take one of them plus 0.5.
    const expected = silu(0.1 * INPUT_SIZE) + 0.5
    const prediction = backend().predict(input)
    expect(prediction.cl).toBeCloseTo(expected, 5)
    expect(prediction.cd).toBeCloseTo(expected, 5)
    expect(prediction.cp[0]).toBeCloseTo(expected, 5)
  })

  it('returns the documented output shape', () => {
    const prediction = backend().predict(new Float32Array(INPUT_SIZE))
    expect(prediction.cp).toHaveLength(128)
    expect(prediction.pod).toHaveLength(32)
    expect(Number.isFinite(prediction.cmQuarter)).toBe(true)
  })

  it('rejects a wrongly sized input', () => {
    expect(() => backend().predict(new Float32Array(5))).toThrow(RangeError)
  })

  it('predicts a batch row by row', () => {
    const rows = 3
    const inputs = new Float32Array(rows * INPUT_SIZE)
    for (let row = 0; row < rows; row += 1) {
      inputs.fill(0.1 * (row + 1), row * INPUT_SIZE, (row + 1) * INPUT_SIZE)
    }
    const predictions = backend().predictBatch(inputs, rows)
    expect(predictions).toHaveLength(rows)
    // Monotone inputs through a monotone network give monotone outputs here.
    expect(predictions[0]!.cl).toBeLessThan(predictions[1]!.cl)
    expect(predictions[1]!.cl).toBeLessThan(predictions[2]!.cl)
  })

  it('allocates nothing per prediction beyond the result', () => {
    // Repeated calls must stay stable, which a shared scratch buffer could easily break.
    const instance = backend()
    const input = new Float32Array(INPUT_SIZE).fill(0.2)
    const first = instance.predict(input)
    const second = instance.predict(input)
    expect(second.cl).toBe(first.cl)
    expect(Array.from(second.cp)).toEqual(Array.from(first.cp))
  })
})

describe('toInput', () => {
  it('lays the design vector out as the model expects', () => {
    const upper = [1, 2, 3, 4, 5, 6]
    const lower = [-1, -2, -3, -4, -5, -6]
    const input = toInput(upper, lower, 3.5)
    expect(Array.from(input)).toEqual([...upper, ...lower, 3.5])
  })
})

describe('toPrediction', () => {
  it('reads a row at an offset, which is how batches are unpacked', () => {
    const output = new Float32Array(2 * OUTPUT_SIZE)
    output[OUTPUT_SIZE + 128] = 1.25
    expect(toPrediction(output, OUTPUT_SIZE).cl).toBe(1.25)
    expect(toPrediction(output, 0).cl).toBe(0)
  })
})

describe('parseWeights', () => {
  it('rejects an unknown format', () => {
    const { buffer, manifest } = toyWeights()
    expect(() => parseWeights(buffer, { ...manifest, format: 'something-else' })).toThrow(
      /Unsupported weight format/,
    )
  })

  it('rejects a blob whose length disagrees with the manifest', () => {
    const { buffer, manifest } = toyWeights()
    expect(() => parseWeights(buffer, { ...manifest, floats: manifest.floats + 1 })).toThrow(
      /declares/,
    )
  })

  it('rejects layers that do not match the model interface', () => {
    const { buffer, manifest } = toyWeights()
    const wrong = { ...manifest, layers: [{ in: 7, out: OUTPUT_SIZE }] }
    expect(() => parseWeights(buffer, wrong)).toThrow(/expected 13/)
  })
})
