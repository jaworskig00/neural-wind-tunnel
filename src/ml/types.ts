/**
 * The surrogate's interface to the rest of the app.
 *
 * Two implementations sit behind this: ONNX Runtime Web, which is the canonical path, and a
 * hand-written forward pass over the raw weight blob. ADR-006 explains why both exist — the second
 * one proves the model is understood rather than merely invoked, keeps a working path if the
 * runtime regresses, and gives the parity test something to compare against.
 */

/** Pressure stations per surface, fixed by `docs/DATASET-SCHEMA.md` section 3. */
export const CP_STATIONS_PER_SURFACE = 64
export const CP_STATION_COUNT = CP_STATIONS_PER_SURFACE * 2

/** Modal coefficients the reduced-order reconstruction needs. */
export const POD_MODE_COUNT = 32

/** Model inputs: twelve CST weights then incidence in degrees. */
export const INPUT_SIZE = 13
export const OUTPUT_SIZE = CP_STATION_COUNT + 3 + POD_MODE_COUNT

export interface Prediction {
  /** Pressure coefficient at the 128 stations: upper surface first, each leading edge to trailing edge. */
  readonly cp: Float32Array
  readonly cl: number
  /**
   * Profile drag. Trained only on rows where the viscous march converged, so it is the least
   * reliable output at the edges of the incidence range; `docs/accuracy.md` quantifies that.
   */
  readonly cd: number
  readonly cmQuarter: number
  /** Coefficients of the velocity perturbation modes, consumed by `src/rom`. */
  readonly pod: Float32Array
}

export interface SurrogateBackend {
  readonly name: 'onnx' | 'typescript'
  /** Predict one design. */
  predict: (input: Float32Array) => Prediction
  /** Predict a batch, laid out row-major as `[rows, INPUT_SIZE]`. */
  predictBatch: (inputs: Float32Array, rows: number) => Prediction[]
  dispose: () => void
}

/** Splits one flat output row into a `Prediction`. The two backends share this so they cannot drift. */
export function toPrediction(output: Float32Array, offset = 0): Prediction {
  const cp = output.slice(offset, offset + CP_STATION_COUNT)
  const scalars = offset + CP_STATION_COUNT
  return {
    cp,
    cl: output[scalars] ?? Number.NaN,
    cd: output[scalars + 1] ?? Number.NaN,
    cmQuarter: output[scalars + 2] ?? Number.NaN,
    pod: output.slice(scalars + 3, scalars + 3 + POD_MODE_COUNT),
  }
}

/** Builds the model input from a section and an incidence. */
export function toInput(
  upperWeights: readonly number[],
  lowerWeights: readonly number[],
  alphaDeg: number,
): Float32Array {
  const input = new Float32Array(INPUT_SIZE)
  input.set(upperWeights, 0)
  input.set(lowerWeights, upperWeights.length)
  input[INPUT_SIZE - 1] = alphaDeg
  return input
}
