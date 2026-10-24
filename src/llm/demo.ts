import type { ChatMessage, Provider, ProviderReply, ProviderRequest } from './types'

/**
 * The assistant without a key.
 *
 * Three recorded conversations, replayed turn by turn. What is recorded is only what the model
 * said and which tools it chose -- the tools themselves really run, against the real surrogate, so
 * every number in a demo answer is computed here and now from the design on screen. That is why
 * the recorded text is written with placeholders rather than figures: a transcript that quoted
 * numbers would be a screenshot pretending to be a conversation.
 *
 * It is also what makes the three scenarios usable as tests. The same transcripts drive
 * `demo.test.ts` against the same dispatcher the live providers use.
 */

export interface DemoScenario {
  readonly id: string
  readonly label: string
  /** What the visitor appears to have typed. */
  readonly prompt: string
  readonly turns: readonly ProviderReply[]
}

function call(id: string, name: string, input: Record<string, unknown>): ProviderReply {
  return { content: '', toolCalls: [{ id, name, input }], stop: 'tool_use' }
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'thinner',
    label: 'Make it thinner',
    prompt: 'Make it about fifteen per cent thinner and tell me what that costs.',
    turns: [
      call('demo-1', 'nudge_shape', { thickness_factor: 0.85 }),
      call('demo-2', 'explain_result', {}),
      {
        content:
          'Thinned to {{design.max_thickness_pct_chord}} % chord. Lift is {{design.cl}} and drag ' +
          '{{design.cd}}, so the section now runs at L/D {{design.lift_to_drag}} at ' +
          '{{design.alpha_deg}}°. Thinning mostly buys drag back from form; it costs you stall ' +
          'margin, which this surrogate cannot see — it was trained below the incidences where ' +
          'that shows up.',
        toolCalls: [],
        stop: 'end',
      },
    ],
  },
  {
    id: 'drag-at-five',
    label: 'Reduce drag at 5°',
    prompt: 'Reduce the drag at five degrees without giving up much lift.',
    turns: [
      call('demo-1', 'set_shape_params', { alpha_deg: 5 }),
      call('demo-2', 'nudge_shape', { thickness_factor: 0.9, camber_factor: 0.85 }),
      call('demo-3', 'run_alpha_sweep', { from_deg: 0, to_deg: 8, points: 17 }),
      {
        content:
          'Took ten per cent off the thickness and fifteen off the camber. At 5° the section is ' +
          'now Cl {{best_lift_to_drag.cl}} against Cd {{best_lift_to_drag.cd}} at its best point ' +
          '({{best_lift_to_drag.alpha_deg}}°). The sweep is the honest part of that answer: a ' +
          'single operating point can always be improved by accident.',
        toolCalls: [],
        stop: 'end',
      },
    ],
  },
  {
    id: 'why-cd',
    label: 'Why did Cd rise?',
    prompt: 'Why did the drag go up?',
    turns: [
      call('demo-1', 'explain_result', {}),
      call('demo-2', 'run_alpha_sweep', { from_deg: -6, to_deg: 10, points: 33 }),
      {
        content:
          'At {{design.alpha_deg}}° the section sits at Cd {{design.cd}}, and the sweep puts its ' +
          'best lift-to-drag at {{best_lift_to_drag.alpha_deg}}°. Away from that point drag grows ' +
          'with the square of the lift you are asking for, and the boundary layer thickens on the ' +
          'suction side until the integral method stops converging. Treat the top of the range as ' +
          'indicative: the solver this was trained on is weakest exactly where drag rises fastest.',
        toolCalls: [],
        stop: 'end',
      },
    ],
  },
]

/**
 * Everything the tools have returned this conversation, later results winning.
 *
 * A scenario that calls `explain_result` and then `run_alpha_sweep` wants to quote from both, so
 * the placeholders resolve against the union rather than the last one. Every value still comes
 * from a tool result in this conversation; none is recorded.
 */
function toolResults(messages: readonly ChatMessage[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const message of messages) {
    if (message.role !== 'tool') continue
    try {
      const parsed: unknown = JSON.parse(message.content)
      if (typeof parsed === 'object' && parsed !== null) {
        Object.assign(merged, parsed)
      }
    } catch {
      // A tool result that is not JSON cannot be quoted from; the placeholder stays visible.
    }
  }
  return merged
}

/** Resolves `{{a.b}}` against what the tools have returned. */
export function fillPlaceholders(text: string, toolResult: unknown): string {
  return text.replace(/\{\{([\w.]+)\}\}/g, (whole, path: string) => {
    let value: unknown = toolResult
    for (const step of path.split('.')) {
      if (typeof value !== 'object' || value === null) return whole
      value = (value as Record<string, unknown>)[step]
    }
    if (value === null || value === undefined) return '—'
    if (typeof value === 'number' || typeof value === 'string') return String(value)
    return whole
  })
}

export function scenarioFor(prompt: string): DemoScenario {
  const [first, ...rest] = DEMO_SCENARIOS
  if (!first) throw new Error('No demo scenarios are defined.')
  return [first, ...rest].find((scenario) => scenario.prompt === prompt) ?? first
}

/**
 * A provider that replays a scenario.
 *
 * Which turn to play is derived from the conversation rather than held as a counter: the number of
 * assistant turns already in it is the number already played. That keeps the provider stateless,
 * so a retry or an undo cannot desynchronise it.
 */
export function createDemoProvider(): Provider {
  return {
    kind: 'demo',
    send(request: ProviderRequest): Promise<ProviderReply> {
      const firstUser = request.messages.find((message) => message.role === 'user')
      const scenario = scenarioFor(firstUser?.role === 'user' ? firstUser.content : '')
      const played = request.messages.filter((message) => message.role === 'assistant').length
      const turn = scenario.turns[played]

      if (!turn) {
        return Promise.resolve({
          content: 'That is the end of this recorded conversation. Add a key to go further.',
          toolCalls: [],
          stop: 'end',
        })
      }

      return Promise.resolve({
        ...turn,
        content: fillPlaceholders(turn.content, toolResults(request.messages)),
      })
    },
  }
}
