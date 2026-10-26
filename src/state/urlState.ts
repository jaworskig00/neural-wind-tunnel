/**
 * Reading and writing the application state in the URL hash.
 *
 * The contract is `docs/URL-STATE.md`, and it is a contract because the sister project builds these
 * links to open a design here. The rules it sets are the ones that matter when someone else's code
 * is generating the string: unknown keys are ignored rather than rejected, missing keys take their
 * default, out-of-range values are clamped and the clamp is visible, and a version it does not
 * recognise loads defaults rather than guessing.
 *
 * The hash is used rather than the query string so a static host never sees the parameters and no
 * round trip is needed.
 */

import { CST_ORDER } from '../geometry/cst'
import { nacaSection } from '../geometry/naca'
import { presetById } from '../geometry/presets'
import {
  type Section,
  TRAINED_ALPHA_RANGE,
  TRAINED_BOUNDS,
  clamp,
  clampToTrainedRange,
} from '../geometry/shapeOps'
import type { ColormapName } from '../scene/pressureScale'
import type { TierChoice, ViewMode } from './store'

export const URL_STATE_VERSION = 1

const DEFAULT_PRESET = 'naca2412'
const VIEW_MODES: readonly ViewMode[] = ['particles', 'streamlines', 'both', 'surface']
const COLORMAPS: readonly ColormapName[] = ['coolwarm', 'cividis']
const TIERS: readonly TierChoice[] = ['auto', 'high', 'mid', 'low']

export interface UrlState {
  readonly section: Section
  readonly alphaDeg: number
  readonly presetId: string | null
  readonly view: ViewMode
  readonly colormap: ColormapName
  readonly tier: TierChoice
  readonly camera: readonly [number, number, number]
}

export interface DecodeResult {
  readonly state: UrlState
  /** What the reader had to correct, for the UI to surface rather than silently apply. */
  readonly notices: string[]
}

export const DEFAULT_CAMERA: readonly [number, number, number] = [45, 18, 3.2]

function defaults(): UrlState {
  const preset = presetById(DEFAULT_PRESET)
  return {
    section: { upper: preset.upper, lower: preset.lower },
    alphaDeg: 2,
    presetId: DEFAULT_PRESET,
    view: 'particles',
    colormap: 'coolwarm',
    tier: 'auto',
    camera: DEFAULT_CAMERA,
  }
}

/** Rounds to the four decimals the contract allows, without trailing zeros. */
function short(value: number): string {
  return Number(value.toFixed(4)).toString()
}

function parseFloats(raw: string | null, count: number): number[] | null {
  if (raw === null) return null
  const parts = raw.split(',').map((part) => Number.parseFloat(part))
  if (parts.length !== count || parts.some((value) => !Number.isFinite(value))) return null
  return parts
}

/** A fixed-length tuple from a parsed list, so the caller needs no index assertions. */
function toTriple(values: number[] | null): readonly [number, number, number] | null {
  const [first, second, third] = values ?? []
  if (first === undefined || second === undefined || third === undefined) return null
  return [first, second, third]
}

export function encode(state: UrlState): string {
  const parameters = new URLSearchParams()
  parameters.set('v', String(URL_STATE_VERSION))
  if (state.presetId !== null) {
    parameters.set('p', state.presetId)
  } else {
    parameters.set('au', state.section.upper.map(short).join(','))
    parameters.set('al', state.section.lower.map(short).join(','))
  }
  parameters.set('a', short(state.alphaDeg))
  parameters.set('view', state.view)
  if (state.colormap !== 'coolwarm') parameters.set('cmap', state.colormap)
  if (state.tier !== 'auto') parameters.set('tier', state.tier)
  parameters.set('cam', state.camera.map(short).join(','))
  // URLSearchParams percent-encodes commas, which makes a shareable link far less readable for
  // something that is only ever parsed by the same decoder.
  return parameters.toString().replace(/%2C/g, ',')
}

export function decode(hash: string): DecodeResult {
  const notices: string[] = []
  const base = defaults()
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (raw.length === 0) return { state: base, notices }

  const parameters = new URLSearchParams(raw)
  const version = Number.parseInt(parameters.get('v') ?? '', 10)
  if (version !== URL_STATE_VERSION) {
    notices.push(
      `This link uses URL format ${parameters.get('v') ?? 'none'}; this build reads ` +
        `${URL_STATE_VERSION}. Showing the default design instead of guessing.`,
    )
    return { state: base, notices }
  }

  let section = base.section
  let presetId: string | null = base.presetId

  const upper = parseFloats(parameters.get('au'), CST_ORDER)
  const lower = parseFloats(parameters.get('al'), CST_ORDER)
  if (upper && lower) {
    const requested: Section = { upper, lower }
    const clamped = clampToTrainedRange(requested, TRAINED_BOUNDS)
    const wasClamped =
      clamped.upper.some((value, index) => value !== upper[index]) ||
      clamped.lower.some((value, index) => value !== lower[index])
    if (wasClamped) {
      notices.push('Some shape weights were outside the trained range and have been clamped.')
    }
    section = clamped
    presetId = null
  } else if (parameters.has('au') || parameters.has('al')) {
    notices.push('The shape weights in this link could not be read; showing NACA 2412.')
  } else if (parameters.has('naca')) {
    /**
     * A section named the way the rest of the world names one.
     *
     * Camber, camber position and thickness as fractions of chord, which this app then fits CST
     * weights to. It exists so a design chosen somewhere that thinks in those three numbers can be
     * opened here without that somewhere having to know anything about Bernstein coefficients --
     * the sister project's design space is exactly such a place. Nothing requires the three to sit
     * on the integer NACA grid, and a sampled design space mostly will not.
     *
     * What it carries is a shape, and only a shape. The incidence rides along in `a` if the link
     * sets it, and the Reynolds number does not: this dataset is one million and nothing else, so a
     * design sampled at another Reynolds number opens here as a different case, and the banner
     * below is where that gets said rather than glossed over.
     */
    const requested = parseFloats(parameters.get('naca'), 3)
    if (!requested) {
      notices.push(
        'The section in this link could not be read; it needs camber, camber position and ' +
          'thickness as three fractions of chord. Showing NACA 2412.',
      )
    } else {
      const [camber, camberPosition, thickness] = requested as [number, number, number]
      try {
        const fitted = nacaSection({ camber, camberPosition, thickness })
        const clamped = clampToTrainedRange(fitted, TRAINED_BOUNDS)
        const wasClamped =
          clamped.upper.some((value, index) => value !== fitted.upper[index]) ||
          clamped.lower.some((value, index) => value !== fitted.lower[index])
        if (wasClamped) {
          notices.push(
            `A section with ${(thickness * 100).toFixed(1)} % thickness and ` +
              `${(camber * 100).toFixed(1)} % camber is outside the range this surrogate was ` +
              'trained on, so it has been clamped to the nearest shape inside it.',
          )
        }
        notices.push(
          'Reynolds number here is fixed at 1×10⁶, whatever it was where this link came from.',
        )
        section = clamped
        presetId = null
      } catch {
        notices.push('That section could not be fitted; showing NACA 2412.')
      }
    }
  } else {
    const preset = parameters.get('p')
    if (preset !== null) {
      try {
        const found = presetById(preset)
        section = { upper: found.upper, lower: found.lower }
        presetId = found.id
      } catch {
        notices.push(`This link names an unknown section, "${preset}"; showing NACA 2412.`)
      }
    }
  }

  let alphaDeg = base.alphaDeg
  const requestedAlpha = Number.parseFloat(parameters.get('a') ?? '')
  if (Number.isFinite(requestedAlpha)) {
    alphaDeg = clamp(requestedAlpha, TRAINED_ALPHA_RANGE[0], TRAINED_ALPHA_RANGE[1])
    if (alphaDeg !== requestedAlpha) {
      notices.push(
        `Incidence ${requestedAlpha}° is outside the trained range and has been clamped to ` +
          `${alphaDeg}°.`,
      )
    }
  }

  const view = VIEW_MODES.find((mode) => mode === parameters.get('view')) ?? base.view
  const colormap = COLORMAPS.find((name) => name === parameters.get('cmap')) ?? base.colormap
  const tier = TIERS.find((name) => name === parameters.get('tier')) ?? base.tier

  const camera = toTriple(parseFloats(parameters.get('cam'), 3))
  return {
    state: {
      section,
      alphaDeg,
      presetId,
      view,
      colormap,
      tier,
      camera: camera ?? base.camera,
    },
    notices,
  }
}
