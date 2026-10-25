import { describe, expect, it } from 'vitest'

import { depositionScale } from './particles'
import { DEFAULT_DECAY } from './trails'

/**
 * The trail buffer's one invariant: what it looks like must not depend on the frame rate.
 *
 * A pixel the flow passes over reaches a steady state where what each frame deposits balances what
 * the fade removes. The fade is exponential in *seconds*, so if deposition is counted per *frame*
 * the balance point moves with the frame rate — four times brighter at 120 fps than at 30.
 *
 * That shipped. On a 120 Hz display the dense band of freshly seeded particles at the inlet
 * saturated to white in under a second while the rest of the field stayed below the first visible
 * step, so the tunnel looked empty with a bright stripe down one edge. It passed review because
 * the only machine that checked it was a software renderer at eight frames a second, where the
 * same arithmetic lands somewhere reasonable.
 *
 * This test is the arithmetic, with no GPU in sight.
 */

/** Where a pixel settles: deposit per frame, decayed per second, summed to infinity. */
function trailSteadyState(deltaSeconds: number): number {
  const deposit = depositionScale(deltaSeconds)
  const removed = 1 - Math.exp(-DEFAULT_DECAY * deltaSeconds)
  return deposit / removed
}

describe('trail brightness', () => {
  // 30 fps is the floor the particle step clamps to; 240 covers a fast display.
  const frameTimes = [1 / 30, 1 / 60, 1 / 90, 1 / 120, 1 / 165, 1 / 240]

  it('settles at the same level whatever the frame rate', () => {
    const reference = trailSteadyState(1 / 60)
    for (const dt of frameTimes) {
      const ratio = trailSteadyState(dt) / reference
      expect(
        Math.abs(ratio - 1),
        `at ${String(Math.round(1 / dt))} fps the trails settle ${ratio.toFixed(2)}x as bright`,
      ).toBeLessThan(0.05)
    }
  })

  it('would not have, had deposition stayed per frame', () => {
    // The old behaviour, kept here so the test states what it is protecting against rather than
    // only that some number is stable.
    const perFrame = (dt: number) => 1 / (1 - Math.exp(-DEFAULT_DECAY * dt))
    expect(perFrame(1 / 120) / perFrame(1 / 30)).toBeGreaterThan(3.5)
  })

  it('deposits nothing in a frame of no duration', () => {
    expect(depositionScale(0)).toBe(0)
  })

  it('deposits one reference frame of light in a reference frame', () => {
    expect(depositionScale(1 / 60)).toBeCloseTo(1, 12)
  })
})
