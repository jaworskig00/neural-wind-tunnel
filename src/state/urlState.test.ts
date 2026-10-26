import { describe, expect, it } from 'vitest'

import { CST_ORDER, sectionMetrics } from '../geometry/cst'
import { presetById } from '../geometry/presets'
import { DEFAULT_CAMERA, URL_STATE_VERSION, decode, encode } from './urlState'

/**
 * These hold the codec to `docs/URL-STATE.md`, which the sister project builds links against. A
 * reader that rejects a link someone else generated, or silently reinterprets it, is the failure
 * mode worth testing for.
 */

const preset = presetById('naca2412')
const base = {
  section: { upper: preset.upper, lower: preset.lower },
  alphaDeg: 2,
  presetId: 'naca2412' as string | null,
  view: 'particles' as const,
  colormap: 'coolwarm' as const,
  tier: 'auto' as const,
  camera: DEFAULT_CAMERA,
}

describe('encode', () => {
  it('always states the contract version', () => {
    expect(encode(base)).toContain(`v=${URL_STATE_VERSION}`)
  })

  it('names a preset rather than spelling out its weights', () => {
    const encoded = encode(base)
    expect(encoded).toContain('p=naca2412')
    expect(encoded).not.toContain('au=')
  })

  it('spells out the weights for an edited section', () => {
    const encoded = encode({ ...base, presetId: null })
    expect(encoded).toContain('au=')
    expect(encoded).toContain('al=')
    expect(encoded).not.toContain('p=')
  })

  it('leaves commas readable rather than percent-encoded', () => {
    expect(encode({ ...base, presetId: null })).toContain(',')
    expect(encode(base)).not.toContain('%2C')
  })

  it('omits defaults that carry no information', () => {
    const encoded = encode(base)
    expect(encoded).not.toContain('cmap=')
    expect(encoded).not.toContain('tier=')
  })

  it('rounds to the four decimals the contract allows', () => {
    const encoded = encode({ ...base, presetId: null, alphaDeg: 2.123456789 })
    expect(encoded).toContain('a=2.1235')
  })
})

describe('decode', () => {
  it('round-trips a preset', () => {
    const { state, notices } = decode(`#${encode(base)}`)
    expect(notices).toEqual([])
    expect(state.presetId).toBe('naca2412')
    expect(state.alphaDeg).toBe(2)
  })

  it('round-trips an edited section to four decimals', () => {
    const edited = {
      ...base,
      presetId: null,
      section: {
        upper: Array.from({ length: CST_ORDER }, (_, i) => 0.1 + i * 0.01),
        lower: Array.from({ length: CST_ORDER }, (_, i) => -0.2 + i * 0.01),
      },
      alphaDeg: -3.5,
    }
    const { state } = decode(`#${encode(edited)}`)
    state.section.upper.forEach((value, index) => {
      expect(value).toBeCloseTo(edited.section.upper[index]!, 4)
    })
    expect(state.alphaDeg).toBeCloseTo(-3.5, 4)
    expect(state.presetId).toBeNull()
  })

  it('returns defaults for an empty hash', () => {
    expect(decode('').state.presetId).toBe('naca2412')
    expect(decode('#').state.alphaDeg).toBe(2)
  })

  it('ignores keys it does not know, so a later version can add them', () => {
    const { state, notices } = decode(`#v=1&p=naca0012&somethingNew=42`)
    expect(state.presetId).toBe('naca0012')
    expect(notices).toEqual([])
  })

  it('loads defaults for a version it does not recognise, and says so', () => {
    const { state, notices } = decode('#v=99&p=naca4412&a=7')
    expect(state.presetId).toBe('naca2412')
    expect(notices.join(' ')).toContain('URL format 99')
  })

  it('clamps incidence outside the trained range and reports it', () => {
    const { state, notices } = decode('#v=1&p=naca0012&a=25')
    expect(state.alphaDeg).toBe(10)
    expect(notices.join(' ')).toContain('clamped')
  })

  it('clamps weights outside the trained range and reports it', () => {
    const wild = Array.from({ length: CST_ORDER }, () => 9).join(',')
    const low = Array.from({ length: CST_ORDER }, () => -9).join(',')
    const { state, notices } = decode(`#v=1&au=${wild}&al=${low}`)
    expect(Math.max(...state.section.upper)).toBeLessThanOrEqual(0.4)
    expect(Math.min(...state.section.lower)).toBeGreaterThanOrEqual(-0.4)
    expect(notices.join(' ')).toContain('clamped')
  })

  it('falls back when the weights are malformed, and says so', () => {
    const { state, notices } = decode('#v=1&au=1,2,3&al=4,5,6')
    expect(state.presetId).toBe('naca2412')
    expect(notices.join(' ')).toContain('could not be read')
  })

  it('falls back when the preset is unknown, and says so', () => {
    const { state, notices } = decode('#v=1&p=naca9999')
    expect(state.presetId).toBe('naca2412')
    expect(notices.join(' ')).toContain('unknown section')
  })

  it('accepts the view, colormap and tier', () => {
    const { state } = decode('#v=1&p=naca0008&view=streamlines&cmap=cividis&tier=low')
    expect(state.view).toBe('streamlines')
    expect(state.colormap).toBe('cividis')
    expect(state.tier).toBe('low')
  })

  it('ignores an unrecognised enum value rather than failing', () => {
    const { state } = decode('#v=1&p=naca0008&view=hologram&cmap=neon&tier=ultra')
    expect(state.view).toBe('particles')
    expect(state.colormap).toBe('coolwarm')
    expect(state.tier).toBe('auto')
  })

  it('reads the camera and falls back when it is malformed', () => {
    expect(decode('#v=1&p=naca0012&cam=10,20,2').state.camera).toEqual([10, 20, 2])
    expect(decode('#v=1&p=naca0012&cam=10,20').state.camera).toEqual(DEFAULT_CAMERA)
  })

  it('reads the deep link the sister project builds', () => {
    // The explorer takes the twelve cst_ columns and alpha_deg straight from a dataset row.
    const upper = '0.194,0.1981,0.2323,0.1735,0.2209,0.2076'
    const lower = '-0.1517,-0.1069,-0.0937,-0.0949,-0.073,-0.0795'
    const { state, notices } = decode(`#v=1&au=${upper}&al=${lower}&a=5&view=particles`)
    expect(notices).toEqual([])
    expect(state.alphaDeg).toBe(5)
    expect(state.section.upper[0]).toBeCloseTo(0.194, 4)
    expect(state.presetId).toBeNull()
  })
})

/**
 * The `naca` key, which is how a design arrives from somewhere that thinks in camber and
 * thickness rather than in Bernstein coefficients.
 */
describe('a section given as camber, position and thickness', () => {
  it('fits the weights and drops the preset', () => {
    const { state, notices } = decode('#v=1&naca=0.04,0.4,0.12&a=5')
    const metrics = sectionMetrics(state.section.upper, state.section.lower)

    expect(metrics.thicknessMax).toBeCloseTo(0.12, 2)
    expect(metrics.camberMax).toBeCloseTo(0.04, 2)
    expect(state.presetId).toBeNull()
    expect(state.alphaDeg).toBe(5)
    // The link carries a shape, not an operating point, so it has to say what it did not carry.
    expect(notices.join(' ')).toContain('Reynolds')
  })

  it('clamps a section outside the trained range and says which one', () => {
    const { notices } = decode('#v=1&naca=0.09,0.6,0.24')
    expect(notices.join(' ')).toMatch(/24\.0 % thickness/)
    expect(notices.join(' ')).toContain('clamped')
  })

  it('refuses a malformed triple rather than guessing', () => {
    const { state, notices } = decode('#v=1&naca=0.04,0.4')
    expect(state.presetId).toBe('naca2412')
    expect(notices.join(' ')).toContain('three fractions of chord')
  })

  it('yields to explicit weights, which are more precise', () => {
    const upper = [0.17, 0.22, 0.19, 0.21, 0.18, 0.14]
    const lower = [-0.14, -0.11, -0.06, 0.02, 0.05, 0.03]
    const hash = `#v=1&au=${upper.join(',')}&al=${lower.join(',')}&naca=0.09,0.6,0.24`
    const { state } = decode(hash)
    expect(state.section.upper[0]).toBeCloseTo(0.17, 6)
  })

  it('takes precedence over a preset name', () => {
    const { state } = decode('#v=1&p=naca0008&naca=0.04,0.4,0.12')
    const metrics = sectionMetrics(state.section.upper, state.section.lower)
    expect(metrics.camberMax).toBeCloseTo(0.04, 2)
    expect(state.presetId).toBeNull()
  })
})
