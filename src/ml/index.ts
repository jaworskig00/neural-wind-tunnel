/**
 * Backend selection.
 *
 * ONNX Runtime Web is the default and the hand-written TypeScript pass is the fallback, chosen in
 * that order for the reasons in ADR-006. `?backend=typescript` forces the fallback, which is how the
 * parity test exercises both without rebuilding.
 */

import { OnnxBackend, loadOnnxBackend } from './onnxBackend'
import { TypeScriptBackend } from './typescriptBackend'
import type { Prediction } from './types'
import { type WeightManifest, parseWeights } from './weights'

export type BackendName = 'onnx' | 'typescript'

export interface Surrogate {
  readonly name: BackendName
  predict: (input: Float32Array) => Promise<Prediction>
  predictBatch: (inputs: Float32Array, rows: number) => Promise<Prediction[]>
  dispose: () => Promise<void>
}

export interface SurrogateSources {
  /** URL of `surrogate.onnx`. */
  readonly onnx: string
  /** URL of `weights.bin`. */
  readonly weights: string
  /** URL of the weight `manifest.json`. */
  readonly manifest: string
}

function wrapSynchronous(backend: TypeScriptBackend): Surrogate {
  return {
    name: backend.name,
    predict: (input) => Promise.resolve(backend.predict(input)),
    predictBatch: (inputs, rows) => Promise.resolve(backend.predictBatch(inputs, rows)),
    dispose: () => {
      backend.dispose()
      return Promise.resolve()
    },
  }
}

function wrapOnnx(backend: OnnxBackend): Surrogate {
  return {
    name: backend.name,
    predict: (input) => backend.predict(input),
    predictBatch: (inputs, rows) => backend.predictBatch(inputs, rows),
    dispose: () => backend.dispose(),
  }
}

export async function loadTypeScriptBackend(sources: SurrogateSources): Promise<Surrogate> {
  const [manifestResponse, weightsResponse] = await Promise.all([
    fetch(sources.manifest),
    fetch(sources.weights),
  ])
  if (!manifestResponse.ok || !weightsResponse.ok) {
    throw new Error(
      `Could not fetch the weight blob: ${manifestResponse.status} / ${weightsResponse.status}`,
    )
  }
  const manifest = (await manifestResponse.json()) as WeightManifest
  const buffer = await weightsResponse.arrayBuffer()
  return wrapSynchronous(new TypeScriptBackend(parseWeights(buffer, manifest)))
}

/**
 * Loads the preferred backend, falling back rather than failing.
 *
 * A reviewer on a browser where the WebAssembly runtime will not start should still see the app
 * work, so a failure here is reported and the fallback takes over.
 */
export async function createBackend(
  sources: SurrogateSources,
  preferred: BackendName = 'onnx',
): Promise<Surrogate> {
  if (preferred === 'typescript') {
    return loadTypeScriptBackend(sources)
  }
  try {
    return wrapOnnx(await loadOnnxBackend(sources.onnx))
  } catch (error) {
    console.warn('ONNX Runtime Web failed to load; falling back to the TypeScript backend', error)
    return loadTypeScriptBackend(sources)
  }
}

export { TypeScriptBackend } from './typescriptBackend'
export { parseWeights } from './weights'
export * from './types'
