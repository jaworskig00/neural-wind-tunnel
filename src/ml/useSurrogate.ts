/**
 * Runs the surrogate against the current design.
 *
 * Predictions are requested on every state change, which during a slider drag means every frame.
 * Two things keep that from thrashing: only the latest request is applied, so an older in-flight
 * prediction cannot overwrite a newer one, and the p95 latency is tracked and exposed so the
 * performance budget can be asserted from a test rather than asserted in prose.
 */

import { useEffect, useRef, useState } from 'react'

import { useAppStore } from '../state/store'
import { type BackendName, type Prediction, type Surrogate, createBackend } from './index'
import { requestedBackend, surrogateSources } from './sources'
import { toInput } from './types'

export interface SurrogateState {
  readonly prediction: Prediction | null
  readonly backend: BackendName | null
  readonly error: string | null
  readonly loading: boolean
  /** Milliseconds for the most recent prediction, and the 95th percentile so far. */
  readonly lastMs: number
  readonly p95Ms: number
}

/** Latency samples kept for the percentile. Enough to be stable, small enough to stay current. */
const LATENCY_WINDOW = 200

/**
 * Predictions ignored before the percentile starts counting.
 *
 * The first calls pay for a cold runtime, a cold JIT and a first texture upload, and they are not
 * what a visitor experiences while dragging a slider. Reporting them pushed a 0.9 ms p95 up to
 * 8.9 ms purely because the sample was small and front-loaded. Discarding the warm-up is standard
 * practice for a latency figure; the alternative -- quoting a number nobody will ever see again --
 * is the misleading one.
 */
const WARMUP_PREDICTIONS = 5

export function useSurrogate(): SurrogateState {
  const section = useAppStore((state) => state.section)
  const alphaDeg = useAppStore((state) => state.alphaDeg)

  const [state, setState] = useState<SurrogateState>({
    prediction: null,
    backend: null,
    error: null,
    loading: true,
    lastMs: 0,
    p95Ms: 0,
  })

  const surrogate = useRef<Surrogate | null>(null)
  const latencies = useRef<number[]>([])
  const completed = useRef(0)
  const requestId = useRef(0)

  useEffect(() => {
    let cancelled = false
    const loaded = createBackend(surrogateSources(), requestedBackend())
      .then((backend) => {
        if (cancelled) {
          void backend.dispose()
          return null
        }
        surrogate.current = backend
        setState((previous) => ({ ...previous, backend: backend.name, loading: false }))
        return backend
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
        return null
      })

    return () => {
      cancelled = true
      void loaded.then((backend) => backend?.dispose())
      surrogate.current = null
    }
  }, [])

  useEffect(() => {
    const backend = surrogate.current
    if (!backend) return

    requestId.current += 1
    const id = requestId.current
    const started = performance.now()

    void backend
      .predict(toInput(section.upper, section.lower, alphaDeg))
      .then((prediction) => {
        // A stale response must never replace a fresher one.
        if (id !== requestId.current) return
        const elapsed = performance.now() - started
        const samples = latencies.current
        completed.current += 1
        if (completed.current > WARMUP_PREDICTIONS) {
          samples.push(elapsed)
          if (samples.length > LATENCY_WINDOW) samples.shift()
        }
        const sorted = [...samples].sort((a, b) => a - b)
        const p95 =
          sorted.length > 0
            ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? elapsed)
            : elapsed

        setState((previous) => ({
          ...previous,
          prediction,
          error: null,
          lastMs: elapsed,
          p95Ms: p95,
        }))
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return
        setState((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : String(error),
        }))
      })
  }, [section, alphaDeg, state.backend])

  return state
}
