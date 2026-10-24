/**
 * The surrogate through ONNX Runtime Web.
 *
 * The canonical path. The runtime and the model are both fetched lazily, off the critical path, so
 * the shell paints before several megabytes of WebAssembly arrive.
 *
 * The runtime's API is asynchronous, so this backend is too, and `src/ml/index.ts` wraps the
 * synchronous TypeScript fallback to match rather than the other way round. A prediction still lands
 * well inside a frame; `docs/accuracy.md` carries the measured latency.
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web'

import { INPUT_SIZE, OUTPUT_SIZE, type Prediction, toPrediction } from './types'

export interface AsyncSurrogateBackend {
  readonly name: 'onnx'
  predict: (input: Float32Array) => Promise<Prediction>
  predictBatch: (inputs: Float32Array, rows: number) => Promise<Prediction[]>
  dispose: () => Promise<void>
}

export class OnnxBackend implements AsyncSurrogateBackend {
  readonly name = 'onnx' as const

  private readonly session: InferenceSession
  private readonly tensorFactory: (data: Float32Array, dims: number[]) => Tensor

  constructor(
    session: InferenceSession,
    tensorFactory: (data: Float32Array, dims: number[]) => Tensor,
  ) {
    this.session = session
    this.tensorFactory = tensorFactory
  }

  async predict(input: Float32Array): Promise<Prediction> {
    const [prediction] = await this.predictBatch(input, 1)
    if (!prediction) {
      throw new Error('ONNX session returned no rows')
    }
    return prediction
  }

  async predictBatch(inputs: Float32Array, rows: number): Promise<Prediction[]> {
    if (inputs.length !== rows * INPUT_SIZE) {
      throw new RangeError(`Expected ${rows * INPUT_SIZE} inputs, got ${inputs.length}`)
    }
    const tensor = this.tensorFactory(inputs, [rows, INPUT_SIZE])
    const results = await this.session.run({ design: tensor })
    const output = results['prediction']?.data
    if (!(output instanceof Float32Array)) {
      throw new Error('ONNX session returned an unexpected output type')
    }
    return Array.from({ length: rows }, (_, row) => toPrediction(output, row * OUTPUT_SIZE))
  }

  async dispose(): Promise<void> {
    await this.session.release()
  }
}

/**
 * Loads the runtime and the model.
 *
 * The dynamic import is what keeps `onnxruntime-web` out of the entry bundle. WebAssembly SIMD and
 * threads are left to the runtime's own detection; forcing them breaks Safari and gains nothing for
 * a model this small.
 */
export async function loadOnnxBackend(modelUrl: string): Promise<OnnxBackend> {
  const ort = await import('onnxruntime-web')
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  return new OnnxBackend(session, (data, dims) => new ort.Tensor('float32', data, dims))
}
