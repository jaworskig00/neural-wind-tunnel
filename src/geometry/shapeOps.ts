/**
 * Shape operations in CST weight space.
 *
 * Both the thickness distribution and the camber line are linear in the CST weights, which makes
 * them separable without leaving weight space:
 *
 *     camber_i    = (A_upper_i + A_lower_i) / 2
 *     halfThick_i = (A_upper_i - A_lower_i) / 2
 *
 * so scaling thickness or camber is a one-line transform rather than a fit. These are the same
 * operations the assistant's `nudge_shape` tool will call in M8, which is why they live here as
 * pure functions rather than inside a component.
 */

import { CST_ORDER, type Weights } from './cst'

export interface Section {
  readonly upper: readonly number[]
  readonly lower: readonly number[]
}

/** Bernstein pattern used to add camber to a section that has none. Loaded toward mid-chord. */
const CAMBER_PATTERN = [0.35, 0.9, 1.0, 0.85, 0.6, 0.3] as const

function split(section: Section): { camber: number[]; halfThickness: number[] } {
  const camber: number[] = []
  const halfThickness: number[] = []
  for (let i = 0; i < CST_ORDER; i += 1) {
    camber.push((section.upper[i]! + section.lower[i]!) / 2)
    halfThickness.push((section.upper[i]! - section.lower[i]!) / 2)
  }
  return { camber, halfThickness }
}

function join(camber: readonly number[], halfThickness: readonly number[]): Section {
  const upper: number[] = []
  const lower: number[] = []
  for (let i = 0; i < CST_ORDER; i += 1) {
    upper.push(camber[i]! + halfThickness[i]!)
    lower.push(camber[i]! - halfThickness[i]!)
  }
  return { upper, lower }
}

/** Multiply the thickness distribution, leaving the camber line untouched. */
export function scaleThickness(section: Section, factor: number): Section {
  const { camber, halfThickness } = split(section)
  return join(
    camber,
    halfThickness.map((value) => value * factor),
  )
}

/** Multiply the camber line, leaving the thickness distribution untouched. */
export function scaleCamber(section: Section, factor: number): Section {
  const { camber, halfThickness } = split(section)
  return join(
    camber.map((value) => value * factor),
    halfThickness,
  )
}

/**
 * Add camber using a fixed mid-loaded pattern, so a symmetric section can gain camber at all --
 * scaling a zero camber line gets you nowhere.
 */
export function addCamber(section: Section, amount: number): Section {
  const { camber, halfThickness } = split(section)
  return join(
    camber.map((value, index) => value + amount * CAMBER_PATTERN[index]!),
    halfThickness,
  )
}

/** Clamp every weight into the dataset's sampling bounds, so the surrogate is never extrapolated. */
export function clampToTrainedRange(section: Section, bounds: WeightBounds): Section {
  return {
    upper: section.upper.map((value, index) =>
      clamp(value, bounds.upper[index]![0], bounds.upper[index]![1]),
    ),
    lower: section.lower.map((value, index) =>
      clamp(value, bounds.lower[index]![0], bounds.lower[index]![1]),
    ),
  }
}

export interface WeightBounds {
  readonly upper: readonly (readonly [number, number])[]
  readonly lower: readonly (readonly [number, number])[]
}

/** The sampling bounds published in `docs/DATASET-SCHEMA.md` section 2. */
export const TRAINED_BOUNDS: WeightBounds = {
  upper: [
    [0.08, 0.3],
    [0.0, 0.4],
    [0.0, 0.4],
    [0.0, 0.4],
    [0.0, 0.4],
    [0.0, 0.3],
  ],
  lower: [
    [-0.3, -0.05],
    [-0.4, 0.15],
    [-0.4, 0.15],
    [-0.4, 0.15],
    [-0.4, 0.15],
    [-0.25, 0.2],
  ],
}

/** Incidence range the dataset covers; see ADR-016. */
export const TRAINED_ALPHA_RANGE = [-6, 10] as const

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/** True when every weight and the incidence sit inside the trained range. */
export function isInsideTrainedRange(section: Section, alphaDeg: number): boolean {
  const withinWeights = (weights: Weights, bounds: WeightBounds['upper']): boolean =>
    weights.every((value, index) => value >= bounds[index]![0] && value <= bounds[index]![1])
  return (
    withinWeights(section.upper, TRAINED_BOUNDS.upper) &&
    withinWeights(section.lower, TRAINED_BOUNDS.lower) &&
    alphaDeg >= TRAINED_ALPHA_RANGE[0] &&
    alphaDeg <= TRAINED_ALPHA_RANGE[1]
  )
}
