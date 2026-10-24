import { Suspense, lazy, useCallback, useState } from 'react'

import { CpChart } from '../charts/CpChart'
import { useSolverOverlay } from '../charts/useSolverOverlay'
import type { TierReport } from '../rom/capabilities'
import { useSurrogate } from '../ml/useSurrogate'
import { useAppStore } from '../state/store'
import { HonestyBanner } from './HonestyBanner'
import { ParameterPanel } from './ParameterPanel'
import { PressureLegend } from './PressureLegend'

/**
 * The renderer is loaded on its own chunk. Three, react-three-fiber and drei together are far
 * larger than everything else in the app, and keeping them out of the entry bundle is what holds
 * the initial payload inside the budget in `package.json` -- the shell paints, then the scene
 * arrives.
 */
const Viewport = lazy(async () => {
  const module = await import('../scene/Viewport')
  return { default: module.Viewport }
})

function ViewportFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-xs text-faint">Loading renderer…</p>
    </div>
  )
}

function Coefficient({
  label,
  value,
  digits,
  title,
}: {
  readonly label: string
  readonly value: number | null
  readonly digits: number
  readonly title?: string
}) {
  return (
    <div className="flex items-baseline gap-1.5" title={title}>
      <span className="text-[0.7rem] text-faint">{label}</span>
      <span className="tabular text-xs text-text" data-testid={`coefficient-${label}`}>
        {value === null || Number.isNaN(value) ? '—' : value.toFixed(digits)}
      </span>
    </div>
  )
}

/**
 * Application shell: header, viewport, parameter panel and the chart dock.
 */
export function App() {
  const alphaDeg = useAppStore((state) => state.alphaDeg)
  const presetId = useAppStore((state) => state.presetId)
  const { prediction, backend, error, loading, p95Ms } = useSurrogate()
  const overlay = useSolverOverlay()
  const [flow, setFlow] = useState<{ name: string; particles: number; frameMs: number } | null>(
    null,
  )
  const handleTier = useCallback((info: TierReport) => {
    setFlow({
      name: info.tier.name,
      particles: info.tier.particles,
      frameMs: info.medianFrameMs,
    })
  }, [])
  const exact = overlay.lookup(presetId, alphaDeg)

  return (
    <div className="flex h-full flex-col bg-base">
      <header className="flex shrink-0 items-baseline justify-between gap-4 border-b border-line px-4 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight">Neural Wind Tunnel</h1>
        <div className="flex items-baseline gap-4">
          <Coefficient label="α" value={alphaDeg} digits={1} />
          <Coefficient
            label="Cl"
            value={prediction?.cl ?? null}
            digits={4}
            title="Lift coefficient"
          />
          <Coefficient
            label="Cd"
            value={prediction?.cd ?? null}
            digits={5}
            title="Profile drag coefficient. Trained only where the viscous march converged."
          />
          <Coefficient
            label="Cm"
            value={prediction?.cmQuarter ?? null}
            digits={4}
            title="Quarter-chord moment, positive nose-up"
          />
          <Coefficient
            label="L/D"
            value={prediction && prediction.cd > 0 ? prediction.cl / prediction.cd : null}
            digits={1}
          />
        </div>
      </header>

      <HonestyBanner />

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <Suspense fallback={<ViewportFallback />}>
            <Viewport prediction={prediction} onTier={handleTier} />
          </Suspense>

          <div className="pointer-events-none absolute top-3 left-4 flex flex-col gap-2">
            <div className="pointer-events-auto">
              <PressureLegend />
            </div>
          </div>

          <div className="absolute right-3 bottom-3 rounded border border-line bg-surface/90 p-2">
            <CpChart cp={prediction?.cp ?? null} reference={exact?.cp ?? null} />
            <p className="mt-1 px-1 text-[0.65rem] text-faint">
              {exact ? (
                <span data-testid="overlay-active">
                  grey: exact solver, Cl {exact.cl.toFixed(4)}
                  {exact.cd !== null && `, Cd ${exact.cd.toFixed(5)}`}
                </span>
              ) : (
                'no solver reference for an edited section'
              )}
            </p>
          </div>

          <p className="pointer-events-none absolute bottom-3 left-4 text-[0.7rem] text-faint">
            {loading && 'Loading the surrogate…'}
            {error !== null && <span className="text-warn">Surrogate unavailable: {error}</span>}
            {!loading && error === null && backend !== null && (
              <span data-testid="inference-status">
                {backend} backend · {p95Ms.toFixed(1)} ms p95
                {flow && (
                  <>
                    {' · '}
                    <span data-testid="flow-status">
                      {(flow.particles / 1000).toFixed(0)}k particles ({flow.name})
                      {flow.frameMs > 0 && ` · ${flow.frameMs.toFixed(1)} ms/frame`}
                    </span>
                  </>
                )}
              </span>
            )}
          </p>
        </main>
        <ParameterPanel />
      </div>
    </div>
  )
}
