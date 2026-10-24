import { describe, expect, it } from 'vitest'

import { presetById } from '../geometry/presets'
import { TRAINED_ALPHA_RANGE } from '../geometry/shapeOps'
import type { Prediction } from '../ml/types'
import { CP_STATION_COUNT, POD_MODE_COUNT } from '../ml/types'
import { type DesignState, type ToolContext, runTool } from './dispatch'

/**
 * A stand-in surrogate with an analytic answer.
 *
 * Thin-aerofoil theory is close enough to be recognisable and simple enough to reason about in a
 * test: lift grows with incidence and camber, drag with the square of lift. What is being tested
 * is the dispatcher's arithmetic and its clamping, not the model's.
 */
function fakePrediction(design: DesignState): Prediction {
  const camber = design.section.upper.reduce(
    (total, value, i) => total + (value + (design.section.lower[i] ?? 0)) / 2,
    0,
  )
  const thickness = design.section.upper.reduce(
    (total, value, i) => total + (value - (design.section.lower[i] ?? 0)) / 2,
    0,
  )
  const cl = 2 * Math.PI * ((design.alphaDeg * Math.PI) / 180) + camber
  return {
    cp: new Float32Array(CP_STATION_COUNT),
    cl,
    cd: 0.006 + 0.02 * cl * cl + 0.01 * thickness,
    cmQuarter: -0.25 * camber,
    pod: new Float32Array(POD_MODE_COUNT),
  }
}

function makeContext(initial?: Partial<DesignState>): ToolContext & { state: DesignState } {
  const preset = presetById('naca2412')
  const holder = {
    state: {
      section: { upper: preset.upper, lower: preset.lower },
      alphaDeg: 2,
      presetId: 'naca2412',
      ...initial,
    } satisfies DesignState,
  }
  return {
    ...holder,
    current: () => holder.state,
    apply: (next) => {
      holder.state = next
    },
    predict: (designs) => Promise.resolve(designs.map(fakePrediction)),
    get state() {
      return holder.state
    },
  }
}

describe('runTool', () => {
  it('refuses a tool it does not have', async () => {
    const outcome = await runTool('delete_everything', {}, makeContext())
    expect(outcome.failed).toBe(true)
    expect(outcome.result['ok']).toBe(false)
  })

  it('loads a preset and reports the coefficients', async () => {
    const context = makeContext()
    const outcome = await runTool('set_shape_params', { preset: 'naca0012' }, context)

    expect(outcome.failed).toBeUndefined()
    expect(context.current().presetId).toBe('naca0012')
    const applied = outcome.result['applied'] as Record<string, unknown>
    expect(applied['preset']).toBe('naca0012')
    expect(applied['max_camber_pct_chord']).toBeCloseTo(0, 2)
  })

  it('rejects an unknown preset without touching the design', async () => {
    const context = makeContext()
    const before = context.current()
    const outcome = await runTool('set_shape_params', { preset: 'naca9999' }, context)

    expect(outcome.failed).toBe(true)
    expect(context.current()).toBe(before)
  })

  it('refuses half a set of weights', async () => {
    const outcome = await runTool('set_shape_params', { upper: [1, 2, 3, 4, 5, 6] }, makeContext())
    expect(outcome.failed).toBe(true)
  })

  it('refuses weights of the wrong length', async () => {
    const outcome = await runTool(
      'set_shape_params',
      { upper: [1, 2, 3], lower: [1, 2, 3] },
      makeContext(),
    )
    expect(outcome.failed).toBe(true)
  })

  it('clamps an incidence outside the trained range and says so', async () => {
    const context = makeContext()
    const outcome = await runTool('set_shape_params', { alpha_deg: 40 }, context)

    expect(context.current().alphaDeg).toBe(TRAINED_ALPHA_RANGE[1])
    expect(outcome.result['clamped_to_trained_range']).toContain('alpha_deg')
    expect(outcome.summary).toContain('Clamped')
  })

  it('clamps weights outside the sampled range', async () => {
    const context = makeContext()
    const outcome = await runTool(
      'set_shape_params',
      { upper: [9, 9, 9, 9, 9, 9], lower: [-9, -9, -9, -9, -9, -9] },
      context,
    )

    const clamped = outcome.result['clamped_to_trained_range'] as string[]
    expect(clamped.length).toBeGreaterThan(0)
    expect(context.current().section.upper.every((value) => value < 1)).toBe(true)
  })

  it('thins a section without moving its camber', async () => {
    const context = makeContext()
    const before = await runTool('explain_result', {}, context)
    const beforeDesign = before.result['design'] as Record<string, number>

    const outcome = await runTool('nudge_shape', { thickness_factor: 0.8 }, context)
    const applied = outcome.result['applied'] as Record<string, number>

    expect(applied['max_thickness_pct_chord']).toBeLessThan(
      beforeDesign['max_thickness_pct_chord'] ?? 0,
    )
    expect(applied['max_camber_pct_chord']).toBeCloseTo(
      beforeDesign['max_camber_pct_chord'] ?? 0,
      2,
    )
  })

  it('reports the coefficient delta a change produced', async () => {
    const context = makeContext()
    const outcome = await runTool('nudge_shape', { alpha_delta_deg: 3 }, context)
    const delta = outcome.result['delta'] as Record<string, number>

    expect(delta['cl']).toBeGreaterThan(0)
    expect(outcome.change?.before.alphaDeg).toBe(2)
    expect(outcome.change?.after.alphaDeg).toBe(5)
  })

  it('refuses a nudge with nothing in it', async () => {
    const outcome = await runTool('nudge_shape', {}, makeContext())
    expect(outcome.failed).toBe(true)
  })

  it('sweeps inside the trained range and finds the best lift-to-drag', async () => {
    const context = makeContext()
    const outcome = await runTool(
      'run_alpha_sweep',
      { from_deg: -20, to_deg: 20, points: 9 },
      context,
    )

    const points = outcome.result['points'] as { alpha_deg: number }[]
    expect(points).toHaveLength(9)
    expect(points[0]?.alpha_deg).toBe(TRAINED_ALPHA_RANGE[0])
    expect(points[8]?.alpha_deg).toBe(TRAINED_ALPHA_RANGE[1])
    expect(outcome.result['clamped_to_trained_range']).toBe(true)
    expect(outcome.result['best_lift_to_drag']).toBeDefined()
  })

  it('leaves the design alone when it only sweeps', async () => {
    const context = makeContext()
    const before = context.current()
    await runTool('run_alpha_sweep', { from_deg: 0, to_deg: 6, points: 4 }, context)
    expect(context.current()).toBe(before)
  })

  it('caps the number of sweep points', async () => {
    const outcome = await runTool(
      'run_alpha_sweep',
      { from_deg: 0, to_deg: 10, points: 5000 },
      makeContext(),
    )
    expect((outcome.result['points'] as unknown[]).length).toBe(41)
  })

  it('explains the current design without changing it', async () => {
    const context = makeContext()
    const outcome = await runTool('explain_result', {}, context)

    expect(outcome.change).toBeUndefined()
    expect(outcome.result['trained_alpha_range_deg']).toEqual(TRAINED_ALPHA_RANGE)
    const design = outcome.result['design'] as Record<string, unknown>
    expect(design['cl']).toBeTypeOf('number')
  })
})
