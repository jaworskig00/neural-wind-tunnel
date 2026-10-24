import { useMemo } from 'react'

import { sectionMetrics } from '../geometry/cst'
import { PRESETS } from '../geometry/presets'
import { TRAINED_ALPHA_RANGE, TRAINED_BOUNDS } from '../geometry/shapeOps'
import { useAppStore } from '../state/store'
import { usePrefersReducedMotion } from './useReducedMotion'

interface SliderProps {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step?: number
  readonly unit?: string
  readonly onChange: (value: number) => void
}

function Slider({ label, value, min, max, step = 0.001, unit = '', onChange }: SliderProps) {
  return (
    <label className="flex items-center gap-3 py-1 text-sm">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <input
        type="range"
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => {
          onChange(Number(event.target.value))
        }}
      />
      <span className="tabular w-16 shrink-0 text-right text-xs text-text">
        {value.toFixed(3)}
        {unit}
      </span>
    </label>
  )
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-faint">{label}</span>
      <span className="tabular text-xs text-text">{value}</span>
    </div>
  )
}

/**
 * Shape and flow controls.
 *
 * Twelve raw CST weights are the source of truth, but nobody thinks in Bernstein coefficients, so
 * the panel leads with presets and the two transforms that matter -- thickness and camber -- and
 * keeps the raw weights available underneath for anyone who wants them. Every slider is bounded by
 * the dataset's own sampling range, so the surrogate is never asked to extrapolate.
 */
export function ParameterPanel() {
  const section = useAppStore((state) => state.section)
  const alphaDeg = useAppStore((state) => state.alphaDeg)
  const presetId = useAppStore((state) => state.presetId)
  const setAlpha = useAppStore((state) => state.setAlpha)
  const setUpperWeight = useAppStore((state) => state.setUpperWeight)
  const setLowerWeight = useAppStore((state) => state.setLowerWeight)
  const loadPreset = useAppStore((state) => state.loadPreset)
  const nudgeThickness = useAppStore((state) => state.nudgeThickness)
  const addCamber = useAppStore((state) => state.addCamber)
  const reset = useAppStore((state) => state.reset)
  const trailIntensity = useAppStore((state) => state.trailIntensity)
  const setTrailIntensity = useAppStore((state) => state.setTrailIntensity)
  const tier = useAppStore((state) => state.tier)
  const setTier = useAppStore((state) => state.setTier)
  const view = useAppStore((state) => state.view)
  const setView = useAppStore((state) => state.setView)
  const motion = useAppStore((state) => state.motion)
  const setMotion = useAppStore((state) => state.setMotion)
  const reduced = usePrefersReducedMotion()

  const metrics = useMemo(() => sectionMetrics(section.upper, section.lower), [section])

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface px-4 py-4">
      <section>
        <h2 className="mb-2 text-[0.7rem] font-semibold tracking-[0.08em] text-muted uppercase">
          Section
        </h2>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => {
                loadPreset(preset.id)
              }}
              className={`rounded border px-2 py-1.5 text-xs transition-colors ${
                presetId === preset.id
                  ? 'border-accent bg-raised text-accent'
                  : 'border-line bg-base text-muted hover:border-faint hover:text-text'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {presetId === null && (
          <p className="mt-2 text-xs text-faint" data-testid="section-edited">
            Edited — no longer a stock section.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[0.7rem] font-semibold tracking-[0.08em] text-muted uppercase">
          Flow
        </h2>
        <Slider
          label="Incidence"
          value={alphaDeg}
          min={TRAINED_ALPHA_RANGE[0]}
          max={TRAINED_ALPHA_RANGE[1]}
          step={0.1}
          unit="°"
          onChange={setAlpha}
        />
        <p className="mt-1 text-xs text-faint">
          Reynolds 1×10<sup>6</sup>, incompressible. Fixed for this dataset.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-[0.7rem] font-semibold tracking-[0.08em] text-muted uppercase">
          Shape
        </h2>
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <button
            type="button"
            className="rounded border border-line bg-base py-1.5 text-muted hover:border-faint hover:text-text"
            onClick={() => {
              nudgeThickness(0.92)
            }}
          >
            Thinner
          </button>
          <button
            type="button"
            className="rounded border border-line bg-base py-1.5 text-muted hover:border-faint hover:text-text"
            onClick={() => {
              nudgeThickness(1.08)
            }}
          >
            Thicker
          </button>
          <button
            type="button"
            className="rounded border border-line bg-base py-1.5 text-muted hover:border-faint hover:text-text"
            onClick={() => {
              addCamber(-0.01)
            }}
          >
            Less camber
          </button>
          <button
            type="button"
            className="rounded border border-line bg-base py-1.5 text-muted hover:border-faint hover:text-text"
            onClick={() => {
              addCamber(0.01)
            }}
          >
            More camber
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[0.7rem] font-semibold tracking-[0.08em] text-muted uppercase">
          Flow field
        </h2>
        <Slider
          label="Trails"
          value={trailIntensity}
          min={0}
          max={2}
          step={0.05}
          onChange={setTrailIntensity}
        />
        <div className="mb-1.5 grid grid-cols-4 gap-1 text-[0.65rem]">
          {(['particles', 'streamlines', 'both', 'surface'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setView(mode)
              }}
              title={
                mode === 'streamlines'
                  ? 'Curves everywhere tangent to the velocity, integrated from the predicted field'
                  : undefined
              }
              className={`rounded border py-1 transition-colors ${
                view === mode
                  ? 'border-accent bg-raised text-accent'
                  : 'border-line bg-base text-muted hover:border-faint hover:text-text'
              }`}
            >
              {mode === 'streamlines' ? 'lines' : mode === 'surface' ? 'none' : mode}
            </button>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1 text-[0.65rem]">
          {(['auto', 'low', 'mid', 'high'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => {
                setTier(choice)
              }}
              className={`rounded border py-1 transition-colors ${
                tier === choice
                  ? 'border-accent bg-raised text-accent'
                  : 'border-line bg-base text-muted hover:border-faint hover:text-text'
              }`}
            >
              {choice}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-faint">
          Particle count. <span className="tabular">auto</span> picks from what the GPU reports.
        </p>

        {reduced && (
          <div
            className="mt-2 rounded border border-line bg-base px-2.5 py-2 text-xs"
            data-testid="reduced-motion-note"
          >
            <p className="text-muted">
              {motion === 'system'
                ? 'Your system asks for reduced motion, so the particles are paused and the same field is drawn as streamlines.'
                : 'Particles are animating despite your reduced-motion setting.'}
            </p>
            <button
              type="button"
              className="mt-1.5 rounded border border-line px-2 py-1 text-muted hover:border-faint hover:text-text"
              onClick={() => {
                setMotion(motion === 'system' ? 'always' : 'system')
              }}
            >
              {motion === 'system' ? 'Animate anyway' : 'Pause the particles'}
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[0.7rem] font-semibold tracking-[0.08em] text-muted uppercase">
          Measured
        </h2>
        <div className="space-y-0.5 rounded border border-line bg-base px-2.5 py-2">
          <Metric label="Max thickness" value={`${(metrics.thicknessMax * 100).toFixed(2)} % c`} />
          <Metric label="at" value={`${(metrics.thicknessMaxX * 100).toFixed(1)} % c`} />
          <Metric label="Max camber" value={`${(metrics.camberMax * 100).toFixed(2)} % c`} />
          <Metric label="at" value={`${(metrics.camberMaxX * 100).toFixed(1)} % c`} />
          <Metric label="Nose radius" value={`${(metrics.leRadius * 100).toFixed(2)} % c`} />
        </div>
      </section>

      <details className="group">
        <summary className="cursor-pointer list-none text-[0.7rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-text">
          CST weights
          <span className="ml-1 text-faint group-open:hidden">▸</span>
          <span className="ml-1 hidden text-faint group-open:inline">▾</span>
        </summary>
        <div className="mt-2">
          <p className="mb-1 text-xs text-faint">Upper surface</p>
          {section.upper.map((value, index) => (
            <Slider
              // The index is the identity here: these are positions in a fixed-length basis.
              key={`upper-${index}`}
              label={`A${index}`}
              value={value}
              min={TRAINED_BOUNDS.upper[index]?.[0] ?? 0}
              max={TRAINED_BOUNDS.upper[index]?.[1] ?? 1}
              onChange={(next) => {
                setUpperWeight(index, next)
              }}
            />
          ))}
          <p className="mt-2 mb-1 text-xs text-faint">Lower surface</p>
          {section.lower.map((value, index) => (
            <Slider
              key={`lower-${index}`}
              label={`A${index}`}
              value={value}
              min={TRAINED_BOUNDS.lower[index]?.[0] ?? -1}
              max={TRAINED_BOUNDS.lower[index]?.[1] ?? 1}
              onChange={(next) => {
                setLowerWeight(index, next)
              }}
            />
          ))}
        </div>
      </details>

      <button
        type="button"
        onClick={reset}
        className="mt-auto rounded border border-line bg-base py-2 text-xs text-muted hover:border-faint hover:text-text"
      >
        Reset
      </button>
    </aside>
  )
}
