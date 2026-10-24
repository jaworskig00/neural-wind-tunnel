import { CST_ORDER, sectionMetrics } from '../geometry/cst'
import { PRESETS, presetById } from '../geometry/presets'
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
import type { Prediction } from '../ml/types'
import { type ToolName, isToolName } from './tools'

/**
 * Running the assistant's tool calls.
 *
 * The dispatcher is where the honesty of the whole feature lives. A model can ask for anything;
 * what it gets is the same thing a slider would get -- clamped to the range the surrogate was
 * trained on, predicted by the same backend, and reported back with every clamp named. It has no
 * second path into the store, and it cannot write a number the app would not have produced itself.
 *
 * Pure, and separate from React: the whole surface is testable without rendering anything, which
 * is what lets the three recorded scenarios run as unit tests.
 */

export interface DesignState {
  readonly section: Section
  readonly alphaDeg: number
  readonly presetId: string | null
}

export interface ToolContext {
  readonly current: () => DesignState
  readonly apply: (next: DesignState) => void
  /** The surrogate, as a batch call: the sweep needs one and a single design is a batch of one. */
  readonly predict: (designs: readonly DesignState[]) => Promise<readonly Prediction[]>
}

export interface ToolOutcome {
  readonly name: string
  /** JSON handed back to the model. */
  readonly result: Record<string, unknown>
  /** One line for the transcript, in the app's voice rather than the model's. */
  readonly summary: string
  /** Present when the call changed the design, so the panel can offer an undo. */
  readonly change?: { readonly before: DesignState; readonly after: DesignState }
  readonly failed?: boolean
}

const MAX_SWEEP_POINTS = 41

function round(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function describe(design: DesignState, prediction: Prediction): Record<string, unknown> {
  const metrics = sectionMetrics(design.section.upper, design.section.lower)
  return {
    preset: design.presetId,
    alpha_deg: round(design.alphaDeg, 2),
    max_thickness_pct_chord: round(metrics.thicknessMax * 100, 2),
    max_thickness_at_pct_chord: round(metrics.thicknessMaxX * 100, 1),
    max_camber_pct_chord: round(metrics.camberMax * 100, 2),
    max_camber_at_pct_chord: round(metrics.camberMaxX * 100, 1),
    leading_edge_radius_pct_chord: round(metrics.leRadius * 100, 2),
    cl: round(prediction.cl, 4),
    cd: Number.isFinite(prediction.cd) ? round(prediction.cd, 5) : null,
    cm_quarter_chord: round(prediction.cmQuarter, 4),
    lift_to_drag: prediction.cd > 0 ? round(prediction.cl / prediction.cd, 1) : null,
  }
}

/**
 * Clamps a proposed design and says what it had to move.
 *
 * Reporting the clamp rather than silently applying it is the whole point: a model that asked for
 * a 30 % thick section and was quietly given a 20 % one would then explain the wrong design.
 */
function constrain(proposed: DesignState): { design: DesignState; clamped: string[] } {
  const clamped: string[] = []
  const section = clampToTrainedRange(proposed.section, TRAINED_BOUNDS)
  for (let i = 0; i < CST_ORDER; i += 1) {
    if (section.upper[i] !== proposed.section.upper[i]) clamped.push(`upper[${String(i)}]`)
    if (section.lower[i] !== proposed.section.lower[i]) clamped.push(`lower[${String(i)}]`)
  }
  const alphaDeg = clamp(proposed.alphaDeg, TRAINED_ALPHA_RANGE[0], TRAINED_ALPHA_RANGE[1])
  if (alphaDeg !== proposed.alphaDeg) clamped.push('alpha_deg')
  return { design: { section, alphaDeg, presetId: proposed.presetId }, clamped }
}

function readNumber(input: Record<string, unknown>, key: string): number | null {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function readWeights(input: Record<string, unknown>, key: string): number[] | null {
  const value = input[key]
  if (!Array.isArray(value) || value.length !== CST_ORDER) return null
  const weights: number[] = []
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null
    weights.push(entry)
  }
  return weights
}

function failure(name: string, reason: string): ToolOutcome {
  return { name, result: { ok: false, error: reason }, summary: reason, failed: true }
}

async function applyAndReport(
  name: ToolName,
  context: ToolContext,
  before: DesignState,
  proposed: DesignState,
  verb: string,
): Promise<ToolOutcome> {
  const { design, clamped } = constrain(proposed)
  context.apply(design)
  const [prediction] = await context.predict([design])
  if (!prediction) return failure(name, 'The surrogate is not loaded yet.')

  const [previous] = await context.predict([before])
  const result: Record<string, unknown> = {
    ok: true,
    applied: describe(design, prediction),
    ...(previous
      ? {
          delta: {
            cl: round(prediction.cl - previous.cl, 4),
            cd:
              Number.isFinite(prediction.cd) && Number.isFinite(previous.cd)
                ? round(prediction.cd - previous.cd, 5)
                : null,
            cm_quarter_chord: round(prediction.cmQuarter - previous.cmQuarter, 4),
          },
        }
      : {}),
    ...(clamped.length > 0
      ? {
          clamped_to_trained_range: clamped,
          note: 'Values outside the trained range were clamped.',
        }
      : {}),
  }
  const delta = previous ? ` Cl ${previous.cl.toFixed(3)} → ${prediction.cl.toFixed(3)}.` : ''
  return {
    name,
    result,
    summary: `${verb}${delta}${clamped.length > 0 ? ' Clamped to the trained range.' : ''}`,
    change: { before, after: design },
  }
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  if (!isToolName(name)) return failure(name, `There is no tool called ${name}.`)
  const before = context.current()

  switch (name) {
    case 'set_shape_params': {
      let section = before.section
      let presetId = before.presetId

      const preset = input['preset']
      if (preset !== undefined) {
        if (typeof preset !== 'string' || !PRESETS.some((entry) => entry.id === preset)) {
          return failure(name, 'That preset does not exist.')
        }
        const loaded = presetById(preset)
        section = { upper: loaded.upper, lower: loaded.lower }
        presetId = loaded.id
      }

      const hasUpper = input['upper'] !== undefined
      const hasLower = input['lower'] !== undefined
      if (hasUpper !== hasLower) {
        return failure(name, 'Give both surfaces or neither: a half-set of weights is not a shape.')
      }
      if (hasUpper && hasLower) {
        const upper = readWeights(input, 'upper')
        const lower = readWeights(input, 'lower')
        if (!upper || !lower) {
          return failure(name, `Each surface needs ${String(CST_ORDER)} finite CST weights.`)
        }
        section = { upper, lower }
        presetId = null
      }

      const alpha =
        input['alpha_deg'] === undefined ? before.alphaDeg : readNumber(input, 'alpha_deg')
      if (alpha === null) return failure(name, 'alpha_deg must be a finite number.')

      return applyAndReport(
        name,
        context,
        before,
        { section, alphaDeg: alpha, presetId },
        'Set the design.',
      )
    }

    case 'nudge_shape': {
      let section = before.section
      let touched = false

      const thickness = input['thickness_factor']
      if (thickness !== undefined) {
        const factor = readNumber(input, 'thickness_factor')
        if (factor === null || factor <= 0) {
          return failure(name, 'thickness_factor must be a positive number.')
        }
        section = scaleThickness(section, factor)
        touched = true
      }

      const camberFactor = input['camber_factor']
      if (camberFactor !== undefined) {
        const factor = readNumber(input, 'camber_factor')
        if (factor === null || factor < 0) {
          return failure(name, 'camber_factor must be zero or more.')
        }
        section = scaleCamber(section, factor)
        touched = true
      }

      const camberDelta = input['camber_delta']
      if (camberDelta !== undefined) {
        const amount = readNumber(input, 'camber_delta')
        if (amount === null) return failure(name, 'camber_delta must be a finite number.')
        section = addCamber(section, amount)
        touched = true
      }

      let alphaDeg = before.alphaDeg
      const alphaDelta = input['alpha_delta_deg']
      if (alphaDelta !== undefined) {
        const amount = readNumber(input, 'alpha_delta_deg')
        if (amount === null) return failure(name, 'alpha_delta_deg must be a finite number.')
        alphaDeg += amount
        touched = true
      }

      if (!touched) return failure(name, 'nudge_shape was called with nothing to change.')

      return applyAndReport(
        name,
        context,
        before,
        { section, alphaDeg, presetId: section === before.section ? before.presetId : null },
        'Nudged the design.',
      )
    }

    case 'run_alpha_sweep': {
      const from = readNumber(input, 'from_deg')
      const to = readNumber(input, 'to_deg')
      if (from === null || to === null) {
        return failure(name, 'from_deg and to_deg must both be finite numbers.')
      }
      const requested = readNumber(input, 'points')
      const points = Math.min(
        MAX_SWEEP_POINTS,
        Math.max(2, Math.round(requested ?? Math.abs(to - from) + 1)),
      )

      const low = clamp(Math.min(from, to), TRAINED_ALPHA_RANGE[0], TRAINED_ALPHA_RANGE[1])
      const high = clamp(Math.max(from, to), TRAINED_ALPHA_RANGE[0], TRAINED_ALPHA_RANGE[1])
      const designs: DesignState[] = []
      for (let i = 0; i < points; i += 1) {
        const t = points === 1 ? 0 : i / (points - 1)
        designs.push({ ...before, alphaDeg: low + (high - low) * t })
      }

      const predictions = await context.predict(designs)
      const rows = predictions.map((prediction, i) => ({
        alpha_deg: round(designs[i]?.alphaDeg ?? Number.NaN, 2),
        cl: round(prediction.cl, 4),
        cd: Number.isFinite(prediction.cd) ? round(prediction.cd, 5) : null,
        cm_quarter_chord: round(prediction.cmQuarter, 4),
      }))
      const best = rows.reduce<(typeof rows)[number] | null>((bestSoFar, row) => {
        if (row.cd === null || row.cd <= 0) return bestSoFar
        if (!bestSoFar || bestSoFar.cd === null) return row
        return row.cl / row.cd > bestSoFar.cl / bestSoFar.cd ? row : bestSoFar
      }, null)

      return {
        name,
        result: {
          ok: true,
          clamped_to_trained_range: low !== Math.min(from, to) || high !== Math.max(from, to),
          points: rows,
          ...(best ? { best_lift_to_drag: best } : {}),
        },
        summary: `Swept ${String(points)} incidences from ${low.toFixed(1)}° to ${high.toFixed(1)}°.`,
      }
    }

    case 'explain_result': {
      const [prediction] = await context.predict([before])
      if (!prediction) return failure(name, 'The surrogate is not loaded yet.')
      return {
        name,
        result: {
          ok: true,
          design: describe(before, prediction),
          trained_alpha_range_deg: TRAINED_ALPHA_RANGE,
          reynolds: 1e6,
          note:
            'These numbers come from the surrogate, which approximates a panel method with an ' +
            'integral boundary layer. Drag is the least reliable output.',
        },
        summary: 'Read the current design.',
      }
    }
  }
}
