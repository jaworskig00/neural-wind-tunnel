import { Suspense, lazy, useCallback, useState } from 'react'

import { CpChart } from '../charts/CpChart'
import { PolarChart } from '../charts/PolarChart'
import { usePolarSweep } from '../charts/usePolarSweep'
import { useSolverOverlay } from '../charts/useSolverOverlay'
import type { TierReport } from '../rom/capabilities'
import { useSurrogate } from '../ml/useSurrogate'
import { useAppStore } from '../state/store'
import { useUrlState } from '../state/useUrlState'
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

/**
 * The assistant is a chunk of its own, loaded the first time it is opened.
 *
 * Two providers, four tool schemas and three recorded transcripts are a few kilobytes that most
 * visits never need. Nothing in the entry bundle imports `src/llm` except through this.
 */
const Assistant = lazy(async () => {
  const module = await import('./Assistant')
  return { default: module.Assistant }
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
  const { prediction, backend, error, loading, p95Ms, surrogate } = useSurrogate()
  const section = useAppStore((state) => state.section)
  const [chart, setChart] = useState<'cp' | 'polar'>('cp')
  const sweep = usePolarSweep(surrogate, section, chart === 'polar')
  const overlay = useSolverOverlay()
  const { notices, dismissNotices } = useUrlState()
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
  const [assistantOpen, setAssistantOpen] = useState(false)
  // Once opened it stays mounted, so closing the panel does not discard the conversation.
  const [assistantLoaded, setAssistantLoaded] = useState(false)
  const exact = overlay.lookup(presetId, alphaDeg)

  return (
    <div className="flex h-full flex-col bg-base">
      <header className="flex shrink-0 items-baseline justify-between gap-4 border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-tight">Neural Wind Tunnel</h1>
          <button
            type="button"
            onClick={() => {
              setAssistantLoaded(true)
              setAssistantOpen((open) => !open)
            }}
            aria-expanded={assistantOpen}
            data-testid="assistant-toggle"
            className={`rounded border px-2 py-0.5 text-[0.65rem] transition-colors ${
              assistantOpen
                ? 'border-accent bg-raised text-accent'
                : 'border-line bg-base text-muted hover:border-faint hover:text-text'
            }`}
          >
            Assistant
          </button>
        </div>
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

      {notices.length > 0 && (
        <div
          className="flex items-start gap-3 border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-[0.7rem] text-warn"
          role="status"
          data-testid="url-notices"
        >
          <span className="flex-1">{notices.join(' ')}</span>
          <button
            type="button"
            onClick={dismissNotices}
            className="shrink-0 underline decoration-dotted underline-offset-2"
          >
            dismiss
          </button>
        </div>
      )}

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
            <div className="mb-1 flex gap-1 px-1">
              {(['cp', 'polar'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setChart(option)
                  }}
                  className={`rounded border px-2 py-0.5 text-[0.65rem] transition-colors ${
                    chart === option
                      ? 'border-accent bg-raised text-accent'
                      : 'border-line bg-base text-muted hover:border-faint hover:text-text'
                  }`}
                >
                  {option === 'cp' ? 'pressure' : 'polars'}
                </button>
              ))}
            </div>

            {chart === 'cp' ? (
              <CpChart cp={prediction?.cp ?? null} reference={exact?.cp ?? null} />
            ) : (
              <PolarChart points={sweep.points} alphaDeg={alphaDeg} />
            )}

            <p className="mt-1 px-1 text-[0.65rem] text-faint">
              {chart === 'polar' ? (
                <span data-testid="polar-status">
                  {sweep.complete
                    ? `${sweep.points.length} points swept across the trained range`
                    : `sweeping… ${sweep.points.length}`}
                </span>
              ) : exact ? (
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
        {assistantLoaded && (
          <Suspense fallback={null}>
            <Assistant
              surrogate={surrogate}
              hidden={!assistantOpen}
              onClose={() => {
                setAssistantOpen(false)
              }}
            />
          </Suspense>
        )}
        <ParameterPanel />
      </div>
    </div>
  )
}
