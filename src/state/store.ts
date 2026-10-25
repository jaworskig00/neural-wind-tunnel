/**
 * Application state.
 *
 * Everything that defines what is on screen lives here, flat and serialisable, because the URL
 * codec in M7 has to round-trip it and the assistant in M8 has to drive it. Derived values --
 * geometry, metrics, predictions -- are computed from this, never stored alongside it.
 */

import { create } from 'zustand'

import type { ColormapName } from '../scene/pressureScale'

import { DEFAULT_PRESET_ID, presetById } from '../geometry/presets'
import {
  type Section,
  TRAINED_ALPHA_RANGE,
  TRAINED_BOUNDS,
  addCamber,
  clamp,
  clampToTrainedRange,
  scaleCamber,
  scaleThickness,
} from '../geometry/shapeOps'

/** Clamp one weight into its own published bound. An index past the end is left untouched. */
function clampWeight(
  bounds: readonly (readonly [number, number])[],
  index: number,
  value: number,
): number {
  const bound = bounds[index]
  return bound ? clamp(value, bound[0], bound[1]) : value
}

export type ViewMode = 'particles' | 'streamlines' | 'both' | 'surface'
export type TierChoice = 'auto' | 'high' | 'mid' | 'low'
/**
 * Whether the particles are allowed to animate.
 *
 * `system` follows `prefers-reduced-motion`; `always` is the explicit override for someone who has
 * the setting on for the rest of their desktop but wants to see this. Deliberately not part of the
 * URL state: a shared link should not impose motion on whoever opens it.
 */
export type MotionChoice = 'system' | 'always'
export type { ColormapName as Colormap } from '../scene/pressureScale'

export interface AppState {
  readonly section: Section
  readonly alphaDeg: number
  readonly presetId: string | null
  /** Set when the current section came from a preset and has not been edited since. */
  readonly view: ViewMode
  readonly colormap: ColormapName
  /** Trail exposure. Tone-mapped, so this is an exposure stop rather than a linear gain. */
  readonly trailIntensity: number
  readonly tier: TierChoice
  readonly motion: MotionChoice

  setUpperWeight: (index: number, value: number) => void
  setLowerWeight: (index: number, value: number) => void
  setAlpha: (alphaDeg: number) => void
  setSection: (section: Section) => void
  loadPreset: (id: string) => void
  nudgeThickness: (factor: number) => void
  nudgeCamber: (factor: number) => void
  addCamber: (amount: number) => void
  setView: (view: ViewMode) => void
  setColormap: (colormap: ColormapName) => void
  setTrailIntensity: (intensity: number) => void
  setTier: (tier: TierChoice) => void
  setMotion: (motion: MotionChoice) => void
  reset: () => void
}

const initialPreset = presetById(DEFAULT_PRESET_ID)

export const useAppStore = create<AppState>((set) => ({
  section: { upper: initialPreset.upper, lower: initialPreset.lower },
  alphaDeg: 2,
  presetId: DEFAULT_PRESET_ID,
  view: 'particles',
  colormap: 'coolwarm',
  trailIntensity: 1,
  tier: 'auto',
  motion: 'system',

  setUpperWeight: (index, value) => {
    set((state) => ({
      presetId: null,
      section: {
        upper: state.section.upper.map((current, i) =>
          i === index ? clampWeight(TRAINED_BOUNDS.upper, i, value) : current,
        ),
        lower: state.section.lower,
      },
    }))
  },

  setLowerWeight: (index, value) => {
    set((state) => ({
      presetId: null,
      section: {
        upper: state.section.upper,
        lower: state.section.lower.map((current, i) =>
          i === index ? clampWeight(TRAINED_BOUNDS.lower, i, value) : current,
        ),
      },
    }))
  },

  setAlpha: (alphaDeg) => {
    set({ alphaDeg: clamp(alphaDeg, TRAINED_ALPHA_RANGE[0], TRAINED_ALPHA_RANGE[1]) })
  },

  setSection: (section) => {
    set({ section: clampToTrainedRange(section, TRAINED_BOUNDS), presetId: null })
  },

  loadPreset: (id) => {
    const preset = presetById(id)
    set({ section: { upper: preset.upper, lower: preset.lower }, presetId: id })
  },

  nudgeThickness: (factor) => {
    set((state) => ({
      presetId: null,
      section: clampToTrainedRange(scaleThickness(state.section, factor), TRAINED_BOUNDS),
    }))
  },

  nudgeCamber: (factor) => {
    set((state) => ({
      presetId: null,
      section: clampToTrainedRange(scaleCamber(state.section, factor), TRAINED_BOUNDS),
    }))
  },

  addCamber: (amount) => {
    set((state) => ({
      presetId: null,
      section: clampToTrainedRange(addCamber(state.section, amount), TRAINED_BOUNDS),
    }))
  },

  setView: (view) => {
    set({ view })
  },

  setTrailIntensity: (trailIntensity) => {
    set({ trailIntensity: clamp(trailIntensity, 0, 3) })
  },

  setMotion: (motion) => {
    set({ motion })
  },

  setTier: (tier) => {
    set({ tier })
  },
  setColormap: (colormap) => {
    set({ colormap })
  },

  reset: () => {
    set({
      section: { upper: initialPreset.upper, lower: initialPreset.lower },
      alphaDeg: 2,
      presetId: DEFAULT_PRESET_ID,
      view: 'particles',
      colormap: 'coolwarm',
      trailIntensity: 1,
      tier: 'auto',
      motion: 'system',
    })
  },
}))
