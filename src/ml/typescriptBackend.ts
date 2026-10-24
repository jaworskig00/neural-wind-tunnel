/**
 * The surrogate as a hand-written forward pass.
 *
 * Eighty lines against several megabytes of WebAssembly. This is the fallback when ONNX Runtime Web
 * is unavailable or disabled, and the reference the parity test holds the runtime to — if these two
 * ever disagree by more than 1e-4, something is wrong and the test says so loudly (ADR-006).
 *
 * The network is three hidden layers of 256 with SiLU, so the whole thing is four matrix-vector
 * products. Buffers are allocated once and reused: this runs on every slider frame.
 */

import {
  INPUT_SIZE,
  OUTPUT_SIZE,
  type Prediction,
  type SurrogateBackend,
  toPrediction,
} from './types'
import type { Weights } from './weights'

/** `x * sigmoid(x)`, the activation the model was trained with. */
function silu(x: number): number {
  return x / (1 + Math.exp(-x))
}

export class TypeScriptBackend implements SurrogateBackend {
  readonly name = 'typescript' as const

  private readonly weights: Weights
  private readonly scratch: Float32Array[]
  private readonly normalisedInput: Float32Array

  constructor(weights: Weights) {
    this.weights = weights
    this.normalisedInput = new Float32Array(INPUT_SIZE)
    // One buffer per layer output, allocated up front so a prediction allocates nothing.
    this.scratch = weights.layers.map((layer) => new Float32Array(layer.out))
  }

  predict(input: Float32Array): Prediction {
    if (input.length !== INPUT_SIZE) {
      throw new RangeError(`Expected ${INPUT_SIZE} inputs, got ${input.length}`)
    }
    const { inputMean, inputScale, outputMean, outputScale, layers } = this.weights

    for (let i = 0; i < INPUT_SIZE; i += 1) {
      this.normalisedInput[i] = (input[i]! - inputMean[i]!) / inputScale[i]!
    }

    let source: Float32Array = this.normalisedInput
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index]!
      const target = this.scratch[index]!
      const isLast = index === layers.length - 1
      for (let row = 0; row < layer.out; row += 1) {
        const base = row * layer.in
        let sum = layer.bias[row]!
        for (let column = 0; column < layer.in; column += 1) {
          sum += layer.weight[base + column]! * source[column]!
        }
        target[row] = isLast ? sum : silu(sum)
      }
      source = target
    }

    const output = new Float32Array(OUTPUT_SIZE)
    for (let i = 0; i < OUTPUT_SIZE; i += 1) {
      output[i] = source[i]! * outputScale[i]! + outputMean[i]!
    }
    return toPrediction(output)
  }

  predictBatch(inputs: Float32Array, rows: number): Prediction[] {
    const predictions: Prediction[] = []
    for (let row = 0; row < rows; row += 1) {
      predictions.push(this.predict(inputs.subarray(row * INPUT_SIZE, (row + 1) * INPUT_SIZE)))
    }
    return predictions
  }

  dispose(): void {
    // Nothing to release: no workers, no WebAssembly heap, no GPU resources.
  }
}
