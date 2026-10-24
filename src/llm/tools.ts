import { CST_ORDER } from '../geometry/cst'
import { PRESETS } from '../geometry/presets'
import { TRAINED_ALPHA_RANGE } from '../geometry/shapeOps'
import type { ToolSchema } from './types'

/**
 * What the assistant is allowed to do.
 *
 * Four tools, and all four go through the same validation the sliders do. The assistant has no
 * privileged path into the store: it proposes a design, the dispatcher clamps it to the range the
 * surrogate was trained on, and the same prediction runs that would run if a human had dragged the
 * sliders there. Nothing it says about the flow comes from the model's own knowledge of
 * aerodynamics -- it comes from `explain_result` and `run_alpha_sweep`, which read the surrogate.
 */

export const TOOL_NAMES = [
  'set_shape_params',
  'nudge_shape',
  'run_alpha_sweep',
  'explain_result',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name)
}

const weightArray = (surface: string) => ({
  type: 'array',
  items: { type: 'number' },
  minItems: CST_ORDER,
  maxItems: CST_ORDER,
  description: `The ${surface} surface's ${String(CST_ORDER)} CST weights, leading edge first.`,
})

export const TOOLS: readonly ToolSchema[] = [
  {
    name: 'set_shape_params',
    description:
      'Set the section and the incidence outright. Give a preset id, or a full set of CST ' +
      'weights for both surfaces, or neither if you only want to change the incidence. Values ' +
      'outside the range the surrogate was trained on are clamped, and the result says so.',
    parameters: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          enum: PRESETS.map((preset) => preset.id),
          description: 'A stock section to load.',
        },
        upper: weightArray('upper'),
        lower: weightArray('lower'),
        alpha_deg: {
          type: 'number',
          minimum: TRAINED_ALPHA_RANGE[0],
          maximum: TRAINED_ALPHA_RANGE[1],
          description: 'Angle of attack in degrees.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'nudge_shape',
    description:
      'Change the current section by a relative amount, leaving everything else alone. This is ' +
      'the right tool for "a bit thinner" or "more camber": thickness and camber are separable ' +
      'in CST weight space, so one can be changed without disturbing the other.',
    parameters: {
      type: 'object',
      properties: {
        thickness_factor: {
          type: 'number',
          minimum: 0.5,
          maximum: 2,
          description: 'Multiplies the thickness distribution. 0.9 is ten per cent thinner.',
        },
        camber_factor: {
          type: 'number',
          minimum: 0,
          maximum: 3,
          description: 'Multiplies the camber line. Zero makes the section symmetric.',
        },
        camber_delta: {
          type: 'number',
          minimum: -0.05,
          maximum: 0.05,
          description:
            'Adds camber as a fraction of chord. Use this rather than camber_factor on a ' +
            'symmetric section, where there is no camber to multiply.',
        },
        alpha_delta_deg: {
          type: 'number',
          minimum: -16,
          maximum: 16,
          description: 'Changes the incidence by this many degrees.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'run_alpha_sweep',
    description:
      'Run the surrogate across a range of incidences on the current section and return the ' +
      'lift, drag and moment at each one. Use it before claiming anything about how a design ' +
      'behaves away from the incidence currently on screen.',
    parameters: {
      type: 'object',
      properties: {
        from_deg: { type: 'number', description: 'Lowest incidence in the sweep.' },
        to_deg: { type: 'number', description: 'Highest incidence in the sweep.' },
        points: {
          type: 'integer',
          minimum: 2,
          maximum: 41,
          description: 'How many incidences to evaluate, inclusive of both ends.',
        },
      },
      required: ['from_deg', 'to_deg'],
      additionalProperties: false,
    },
  },
  {
    name: 'explain_result',
    description:
      'Read the current design: its measured geometry, the predicted coefficients, and whether ' +
      'it sits inside the range the surrogate was trained on. Call this before explaining ' +
      'anything, and after any change, rather than estimating the numbers yourself.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

export const SYSTEM_PROMPT = `You are the assistant inside Neural Wind Tunnel, a browser app that
predicts the flow around a 2D aerofoil with a neural surrogate trained on a panel-method solver
with an integral boundary layer.

Ground rules:
- Every number you state about a design must come from a tool result in this conversation. Never
  estimate a coefficient, and never recall one from training. If you have not called a tool, you
  do not know the answer yet.
- The surrogate is an approximation of a solver that is itself an approximation. It was trained at
  Reynolds 1e6, incompressible, for incidence between ${String(TRAINED_ALPHA_RANGE[0])} and
  ${String(TRAINED_ALPHA_RANGE[1])} degrees. Say so when it matters, and say when a result sits
  near the edge of what it was trained on.
- Prefer nudge_shape for relative changes and set_shape_params for absolute ones. After changing
  anything, call explain_result and report what actually happened, including when it was not what
  you intended.
- Be brief. Two or three sentences, in the register of an engineer talking to an engineer. No
  bullet lists unless you are comparing more than two designs, and no exclamation marks.`
