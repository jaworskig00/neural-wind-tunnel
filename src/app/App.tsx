import { Suspense, lazy } from 'react'

import { ParameterPanel } from './ParameterPanel'
import { useAppStore } from '../state/store'

/**
 * The renderer is loaded on its own chunk. Three, react-three-fiber and drei together are far
 * larger than everything else in the app, and keeping them out of the entry bundle is what holds
 * the initial payload inside the budget in `package.json` -- the shell paints, then the scene
 * arrives. The chart and inference layers will split the same way.
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

/**
 * Application shell: header, viewport, parameter panel, and the chart dock the Cp plot and polars
 * land in during M5 and M7.
 */
export function App() {
  const alphaDeg = useAppStore((state) => state.alphaDeg)

  return (
    <div className="flex h-full flex-col bg-base">
      <header className="flex shrink-0 items-baseline justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold tracking-tight">Neural Wind Tunnel</h1>
          <span className="text-xs text-faint">
            surrogate flow prediction · an approximation, not a solver
          </span>
        </div>
        <span className="tabular text-xs text-muted">α {alphaDeg.toFixed(1)}°</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <Suspense fallback={<ViewportFallback />}>
            <Viewport />
          </Suspense>
          <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-faint">
            Milestone M4 — geometry only. Pressure in M5, flow field in M6.
          </p>
        </main>
        <ParameterPanel />
      </div>
    </div>
  )
}
