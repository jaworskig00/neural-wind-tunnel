import { describe, expect, it } from 'vitest'

import { presetById } from '../geometry/presets'
import { CP_STATION_COUNT, POD_MODE_COUNT, type Prediction } from '../ml/types'
import { runTurn } from './conversation'
import { DEMO_SCENARIOS, createDemoProvider, fillPlaceholders } from './demo'
import type { DesignState, ToolContext } from './dispatch'

/**
 * The three recorded scenarios, end to end.
 *
 * This is the acceptance test for M8: each one runs the whole loop -- provider, tool dispatch,
 * surrogate, back to the provider -- and has to end with an answer that contains no unresolved
 * placeholder. An unresolved `{{...}}` means a recorded answer quoted a number the tools did not
 * actually produce, which is precisely the failure mode a recorded demo invites.
 */

function fakePrediction(design: DesignState): Prediction {
  const camber = design.section.upper.reduce(
    (total, value, i) => total + (value + (design.section.lower[i] ?? 0)) / 2,
    0,
  )
  const cl = 2 * Math.PI * ((design.alphaDeg * Math.PI) / 180) + camber
  return {
    cp: new Float32Array(CP_STATION_COUNT),
    cl,
    cd: 0.006 + 0.02 * cl * cl,
    cmQuarter: -0.25 * camber,
    pod: new Float32Array(POD_MODE_COUNT),
  }
}

function makeContext(): ToolContext & { log: string[] } {
  const preset = presetById('naca2412')
  const log: string[] = []
  let state: DesignState = {
    section: { upper: preset.upper, lower: preset.lower },
    alphaDeg: 2,
    presetId: 'naca2412',
  }
  return {
    log,
    current: () => state,
    apply: (next) => {
      state = next
    },
    predict: (designs) => {
      log.push(`predict x${String(designs.length)}`)
      return Promise.resolve(designs.map(fakePrediction))
    },
  }
}

describe('the recorded scenarios', () => {
  for (const scenario of DEMO_SCENARIOS) {
    it(`plays "${scenario.label}" to a finished answer`, async () => {
      const context = makeContext()
      const { events } = await runTurn(createDemoProvider(), context, [
        { role: 'user', content: scenario.prompt },
      ])

      const toolEvents = events.filter((event) => event.kind === 'tool')
      const answers = events.filter((event) => event.kind === 'assistant')

      expect(toolEvents.length).toBeGreaterThan(0)
      expect(toolEvents.every((event) => event.outcome?.failed !== true)).toBe(true)
      expect(answers).toHaveLength(1)

      const answer = answers[0]?.text ?? ''
      expect(answer).not.toMatch(/\{\{/)
      expect(answer.length).toBeGreaterThan(80)

      // Every number in the answer came from a tool result, which is the point of the templating.
      expect(context.log.length).toBeGreaterThan(0)
    })
  }

  it('runs the tools for real rather than replaying their results', async () => {
    const context = makeContext()
    const before = context.current()

    const scenario = DEMO_SCENARIOS[0]
    await runTurn(createDemoProvider(), context, [
      { role: 'user', content: scenario?.prompt ?? '' },
    ])

    // The thinning scenario really thinned the section the test started from.
    expect(context.current().section.upper[0]).toBeLessThan(before.section.upper[0] ?? 0)
  })

  it('says it has run out of recording rather than inventing more', async () => {
    const context = makeContext()
    const scenario = DEMO_SCENARIOS[0]
    const first = await runTurn(createDemoProvider(), context, [
      { role: 'user', content: scenario?.prompt ?? '' },
    ])

    const second = await runTurn(createDemoProvider(), context, [
      ...first.messages,
      { role: 'user', content: 'and now make it thicker again' },
    ])

    expect(second.events.at(-1)?.text).toContain('recorded conversation')
  })
})

describe('fillPlaceholders', () => {
  it('resolves a dotted path', () => {
    expect(fillPlaceholders('Cl is {{design.cl}}.', { design: { cl: 0.42 } })).toBe('Cl is 0.42.')
  })

  it('leaves a path it cannot resolve as it found it', () => {
    expect(fillPlaceholders('{{a.b.c}}', { a: 1 })).toBe('{{a.b.c}}')
  })

  it('renders a null result as an em dash rather than the word null', () => {
    expect(fillPlaceholders('{{design.cd}}', { design: { cd: null } })).toBe('—')
  })
})
