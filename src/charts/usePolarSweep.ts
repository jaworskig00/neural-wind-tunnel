/**
 * Sweeps the incidence range and collects the resulting coefficients.
 *
 * A polar needs the whole curve, not the current point, so this runs the surrogate across the
 * trained range whenever the section changes. At 0.9 ms a prediction, forty of them is about
 * 36 ms -- two dropped frames if done in one go, while the user is dragging a slider and watching
 * the result.
 *
 * So it is spread across animation frames, a few points at a time, and a new section cancels the
 * sweep in flight rather than queueing behind it. A worker would also solve this, at the cost of a
 * second bundle and copying the model into it; chunking costs nothing and keeps the whole thing on
 * one page of code.
 */

import { useEffect, useRef, useState } from 'react'

import type { Prediction, Surrogate } from '../ml'
import { toInput } from '../ml/types'
import { TRAINED_ALPHA_RANGE, type Section } from '../geometry/shapeOps'

/** Points across the incidence range. Enough for a smooth curve, few enough to stay cheap. */
export const SWEEP_POINTS = 41

/** Predictions computed per animation frame. */
const CHUNK = 6

export interface PolarPoint {
  readonly alphaDeg: number
  readonly cl: number
  readonly cd: number
  readonly cmQuarter: number
}

export interface PolarSweep {
  readonly points: PolarPoint[]
  readonly complete: boolean
}

function alphaAt(index: number): number {
  const [low, high] = TRAINED_ALPHA_RANGE
  return low + ((high - low) * index) / (SWEEP_POINTS - 1)
}

export function usePolarSweep(
  surrogate: Surrogate | null,
  section: Section,
  enabled: boolean,
): PolarSweep {
  const [sweep, setSweep] = useState<PolarSweep>({ points: [], complete: false })
  const generation = useRef(0)

  useEffect(() => {
    if (!surrogate || !enabled) {
      setSweep({ points: [], complete: false })
      return
    }

    generation.current += 1
    const mine = generation.current
    const points: PolarPoint[] = []
    let index = 0
    let frame = 0

    const run = (): void => {
      if (mine !== generation.current) return

      const inputs = new Float32Array(CHUNK * 13)
      const angles: number[] = []
      let count = 0
      while (count < CHUNK && index < SWEEP_POINTS) {
        const alphaDeg = alphaAt(index)
        inputs.set(toInput(section.upper, section.lower, alphaDeg), count * 13)
        angles.push(alphaDeg)
        count += 1
        index += 1
      }
      if (count === 0) {
        setSweep({ points, complete: true })
        return
      }

      void surrogate
        .predictBatch(inputs.subarray(0, count * 13), count)
        .then((predictions: Prediction[]) => {
          if (mine !== generation.current) return
          predictions.forEach((prediction, offset) => {
            points.push({
              alphaDeg: angles[offset] ?? 0,
              cl: prediction.cl,
              cd: prediction.cd,
              cmQuarter: prediction.cmQuarter,
            })
          })
          setSweep({ points: [...points], complete: index >= SWEEP_POINTS })
          frame = requestAnimationFrame(run)
        })
        .catch(() => {
          // A failed sweep leaves the polar empty rather than half-drawn and wrong.
          if (mine === generation.current) setSweep({ points: [], complete: false })
        })
    }

    frame = requestAnimationFrame(run)
    return () => {
      generation.current += 1
      cancelAnimationFrame(frame)
    }
  }, [surrogate, section, enabled])

  return sweep
}
