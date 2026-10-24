import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { TypeScriptBackend } from './typescriptBackend'
import { INPUT_SIZE, OUTPUT_SIZE } from './types'
import { type WeightManifest, parseWeights } from './weights'

/**
 * Numerical parity between the TypeScript forward pass and the Python original.
 *
 * ADR-006 keeps a hand-written forward pass alongside ONNX Runtime Web, and this is what makes it
 * worth having: if the export path or the weight layout drifts, this fails. The reference case comes
 * from `tools/train/export.py`, generated from the trained PyTorch module, so both implementations
 * are held to one source of truth rather than to each other. The ONNX graph is held to the same file
 * by `tools/train/check_artifact.py`, which also asserts the two artifacts agree.
 *
 * Skipped when the artifacts are absent, since `pnpm models:sync` needs either a local training run
 * or the published Release.
 */

interface ReferenceCase {
  readonly inputs: number[][]
  readonly outputs: number[][]
  readonly tolerance: number
  readonly alphaDeg: number[]
}

function load(): { reference: ReferenceCase; backend: TypeScriptBackend } | null {
  try {
    const reference = JSON.parse(
      readFileSync('public/models/reference_case.json', 'utf8'),
    ) as ReferenceCase
    const manifest = JSON.parse(
      readFileSync('public/models/manifest.json', 'utf8'),
    ) as WeightManifest
    const blob = readFileSync('public/models/weights.bin')
    const buffer = blob.buffer.slice(
      blob.byteOffset,
      blob.byteOffset + blob.byteLength,
    ) as ArrayBuffer
    return { reference, backend: new TypeScriptBackend(parseWeights(buffer, manifest)) }
  } catch {
    return null
  }
}

const loaded = load()

describe.skipIf(loaded === null)('parity with the Python reference', () => {
  it('reproduces every reference row', () => {
    const { reference, backend } = loaded!
    reference.inputs.forEach((row, index) => {
      const prediction = backend.predict(new Float32Array(row))
      const flat = [
        ...prediction.cp,
        prediction.cl,
        prediction.cd,
        prediction.cmQuarter,
        ...prediction.pod,
      ]
      expect(flat).toHaveLength(OUTPUT_SIZE)

      const expected = reference.outputs[index]!
      let worst = 0
      for (let i = 0; i < flat.length; i += 1) {
        worst = Math.max(worst, Math.abs(flat[i]! - expected[i]!))
      }
      expect(worst, `row ${index} at ${reference.alphaDeg[index]} degrees`).toBeLessThan(
        reference.tolerance,
      )
    })
  })

  it('reads a design vector of the expected width', () => {
    const { reference } = loaded!
    for (const row of reference.inputs) {
      expect(row).toHaveLength(INPUT_SIZE)
    }
  })

  it('predicts physically plausible coefficients for the reference sections', () => {
    // A model that is numerically faithful to a broken export would pass the check above.
    const { reference, backend } = loaded!
    for (const row of reference.inputs) {
      const prediction = backend.predict(new Float32Array(row))
      expect(Math.abs(prediction.cl)).toBeLessThan(3)
      expect(prediction.cd).toBeGreaterThan(0)
      expect(prediction.cd).toBeLessThan(0.05)
      expect(Math.abs(prediction.cmQuarter)).toBeLessThan(0.5)
      expect(Math.max(...prediction.cp)).toBeLessThanOrEqual(1.05)
    }
  })

  it('increases lift with incidence across the reference sweep', () => {
    const { reference, backend } = loaded!
    const lift = reference.inputs.map((row) => backend.predict(new Float32Array(row)).cl)
    for (let i = 1; i < lift.length; i += 1) {
      expect(lift[i]!).toBeGreaterThan(lift[i - 1]!)
    }
  })
})
