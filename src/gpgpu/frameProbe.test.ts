import { describe, expect, it } from 'vitest'

import { FrameProbe } from './frameProbe'

const FAST = 1 / 120
const SLOW = 1 / 25

function feed(probe: FrameProbe, seconds: number, frames: number) {
  let last = null
  for (let i = 0; i < frames; i += 1) {
    const result = probe.record(seconds)
    if (result) last = result
  }
  return last
}

describe('FrameProbe', () => {
  it('starts at the tier it was given', () => {
    expect(new FrameProbe('high').tier.name).toBe('high')
    expect(new FrameProbe('low').tier.name).toBe('low')
  })

  it('holds before deciding anything, so a cold start cannot force a downgrade', () => {
    const probe = new FrameProbe('high')
    // The first frames after a tier change are the slowest and the least representative.
    expect(feed(probe, SLOW, 40)).toBeNull()
    expect(probe.tier.name).toBe('high')
  })

  it('steps down when frames are slow', () => {
    const probe = new FrameProbe('high')
    const result = feed(probe, SLOW, 200)
    expect(result?.changed).toBe(true)
    expect(probe.tier.name).toBe('mid')
  })

  it('keeps stepping down while frames stay slow, but stops at the lowest tier', () => {
    const probe = new FrameProbe('high')
    feed(probe, SLOW, 2000)
    expect(probe.tier.name).toBe('low')
  })

  it('steps up when frames are comfortably fast', () => {
    const probe = new FrameProbe('low')
    feed(probe, FAST, 200)
    expect(probe.tier.name).toBe('mid')
  })

  it('does not oscillate between two tiers on borderline frames', () => {
    // Between the two thresholds nothing should move, which is the point of the gap.
    const probe = new FrameProbe('mid')
    feed(probe, 0.015, 1000)
    expect(probe.tier.name).toBe('mid')
  })

  it('reports the median rather than the mean, so one long frame is ignored', () => {
    const probe = new FrameProbe('high')
    feed(probe, FAST, 60)
    for (let i = 0; i < 48; i += 1) probe.record(FAST)
    const result = probe.record(1.0)
    expect(result?.medianFrameMs ?? 0).toBeLessThan(12)
  })

  it('stops deciding once frozen', () => {
    const probe = new FrameProbe('high')
    probe.freeze()
    expect(feed(probe, SLOW, 500)).toBeNull()
    expect(probe.tier.name).toBe('high')
  })
})
