/**
 * Picks a particle count from measured frame times.
 *
 * A capability check says what the hardware claims to support; it says nothing about whether it
 * will sustain a million particles. So the tier starts from the capability guess and then moves on
 * evidence: a window of frame times, a median rather than a mean so one long frame cannot force a
 * downgrade, and a hold between changes so the probe cannot oscillate.
 *
 * It steps down quickly and up slowly, which is the asymmetry a viewer actually wants: dropping a
 * tier is barely visible, while stuttering is the first thing anyone notices.
 */

import { PARTICLE_TIERS, type Tier, type TierName } from '../rom/capabilities'

/** Frames collected before a decision. About a second at 60 fps. */
const WINDOW = 50

/** Frames to wait after a change before measuring again, so the new tier settles first. */
const HOLD = 60

/** Milliseconds per frame above which the tier steps down. 60 fps is 16.7 ms. */
const DOWNGRADE_MS = 20

/** Below this the tier may step up, with margin so it does not immediately bounce back. */
const UPGRADE_MS = 11

export interface ProbeResult {
  readonly tier: Tier
  readonly medianFrameMs: number
  readonly changed: boolean
}

export class FrameProbe {
  private samples: number[] = []
  private hold = HOLD
  private index: number

  constructor(startingTier: TierName) {
    this.index = PARTICLE_TIERS.findIndex((tier) => tier.name === startingTier)
    if (this.index < 0) this.index = 1
  }

  get tier(): Tier {
    return PARTICLE_TIERS[this.index]!
  }

  get medianFrameMs(): number {
    if (this.samples.length === 0) return 0
    const sorted = [...this.samples].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
  }

  /** Records a frame and returns a decision once enough have been seen. */
  record(deltaSeconds: number): ProbeResult | null {
    if (this.hold > 0) {
      this.hold -= 1
      return null
    }

    this.samples.push(deltaSeconds * 1000)
    if (this.samples.length < WINDOW) return null

    const median = this.medianFrameMs
    this.samples = []

    // Index 0 is the largest tier, so stepping down means stepping up the index.
    let changed = false
    if (median > DOWNGRADE_MS && this.index < PARTICLE_TIERS.length - 1) {
      this.index += 1
      changed = true
    } else if (median < UPGRADE_MS && this.index > 0) {
      this.index -= 1
      changed = true
    }

    if (changed) this.hold = HOLD
    return { tier: this.tier, medianFrameMs: median, changed }
  }

  /** Stops the probe making further changes, for when the viewer has chosen a tier themselves. */
  freeze(): void {
    this.hold = Number.POSITIVE_INFINITY
  }
}
