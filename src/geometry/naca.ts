/**
 * NACA four-digit sections, expressed in this project's own parametrisation.
 *
 * The app thinks in twelve CST weights; the rest of the world, and the sister project's dataset,
 * thinks in camber, camber position and thickness. This is the bridge: generate the section from
 * those three numbers, then fit CST weights to it by least squares.
 *
 * It is a port of `fit_cst` and `naca4` in `tools/solver/geometry.py`, and
 * `naca.test.ts` holds it to that original against a committed fixture. The fit is a solve, not a
 * lookup, so the two implementations can drift; the fixture is what stops them.
 *
 * The three inputs are fractions of chord, not the digits of a designation. NACA 2412 is
 * `(0.02, 0.4, 0.12)`, but nothing here requires a design to sit on the integer grid -- and the
 * designs that arrive from a sampled design space mostly do not.
 */

import { CST_ORDER, type Point, classFunction, cosineSpacing } from './cst'
import type { Section } from './shapeOps'

/** Matches the panel count the fixture was generated at; the fit is insensitive to it. */
const FIT_PANELS = 200

/** Binomial coefficients of order `CST_ORDER - 1`, the Bernstein basis this project uses. */
const BINOMIAL = [1, 5, 10, 10, 5, 1] as const

function bernstein(psi: number, index: number): number {
  const n = CST_ORDER - 1
  return (BINOMIAL[index] ?? 0) * psi ** index * (1 - psi) ** (n - index)
}

export interface NacaParameters {
  /** Maximum camber, as a fraction of chord. */
  readonly camber: number
  /** Where that maximum sits, as a fraction of chord. Ignored when the camber is zero. */
  readonly camberPosition: number
  /** Maximum thickness, as a fraction of chord. */
  readonly thickness: number
}

/**
 * The two surfaces, leading edge to trailing edge.
 *
 * The thickness polynomial's last coefficient is -0.1036 rather than the original -0.1015, which
 * closes the trailing edge exactly instead of leaving it open by half a per cent of chord. Both
 * ends are then snapped onto the camber line, because the polynomial still leaves a rounding
 * residue there.
 */
export function nacaSurfaces(
  { camber, camberPosition, thickness }: NacaParameters,
  panelCount = FIT_PANELS,
): { upper: Point[]; lower: Point[] } {
  const x = cosineSpacing(panelCount / 2 + 1)
  const upper: Point[] = []
  const lower: Point[] = []

  for (let i = 0; i < x.length; i += 1) {
    const psi = x[i]!
    const half =
      5 *
      thickness *
      (0.2969 * Math.sqrt(psi) -
        0.126 * psi -
        0.3516 * psi ** 2 +
        0.2843 * psi ** 3 -
        0.1036 * psi ** 4)

    let line = 0
    let slope = 0
    if (camber !== 0 && camberPosition !== 0) {
      const p = camberPosition
      const m = camber
      if (psi < p) {
        line = (m / p ** 2) * (2 * p * psi - psi ** 2)
        slope = ((2 * m) / p ** 2) * (p - psi)
      } else {
        line = (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * psi - psi ** 2)
        slope = ((2 * m) / (1 - p) ** 2) * (p - psi)
      }
    }

    const theta = Math.atan(slope)
    upper.push({ x: psi - half * Math.sin(theta), z: line + half * Math.cos(theta) })
    lower.push({ x: psi + half * Math.sin(theta), z: line - half * Math.cos(theta) })
  }

  // Snap both ends shut. The camber line of a four-digit section is zero at the leading edge and,
  // since `(1 - 2p) + 2p - 1` cancels exactly, zero at the trailing edge too -- so both ends sit on
  // the chord line and the only thing being removed here is the thickness polynomial's rounding
  // residue, which would otherwise leave the section open by a fraction of a per cent.
  upper[0] = { x: 0, z: 0 }
  lower[0] = { x: 0, z: 0 }
  upper[upper.length - 1] = { x: 1, z: 0 }
  lower[lower.length - 1] = { x: 1, z: 0 }

  return { upper, lower }
}

/**
 * Least-squares CST weights for one surface.
 *
 * `z = C(psi) * (B(psi) . A)` is linear in the weights, so this is one small normal-equation
 * solve. The endpoints are dropped because the class function vanishes there and the row carries
 * no information about any weight. Six unknowns against a hundred rows, in a basis that is well
 * conditioned over the unit interval, so the normal equations are safe here; the fixture test is
 * what proves that rather than the assertion.
 */
export function fitCstWeights(surface: readonly Point[]): number[] {
  const normal: number[][] = Array.from({ length: CST_ORDER }, () =>
    new Array<number>(CST_ORDER).fill(0),
  )
  const rhs = new Array<number>(CST_ORDER).fill(0)

  for (const point of surface) {
    const psi = point.x
    if (psi <= 1e-9 || psi >= 1 - 1e-9) continue
    const c = classFunction(psi)
    const row: number[] = []
    for (let j = 0; j < CST_ORDER; j += 1) row.push(c * bernstein(psi, j))
    for (let j = 0; j < CST_ORDER; j += 1) {
      const rowJ = row[j] ?? 0
      rhs[j] = (rhs[j] ?? 0) + rowJ * point.z
      const normalJ = normal[j]
      if (!normalJ) continue
      for (let k = 0; k < CST_ORDER; k += 1) {
        normalJ[k] = (normalJ[k] ?? 0) + rowJ * (row[k] ?? 0)
      }
    }
  }

  return solve(normal, rhs)
}

/** Gaussian elimination with partial pivoting, for a matrix of six rows. */
function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length
  const a = matrix.map((row, i) => [...row, vector[i]!])

  for (let column = 0; column < n; column += 1) {
    let pivot = column
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row
    }
    const swap = a[column]!
    a[column] = a[pivot]!
    a[pivot] = swap

    const head = a[column]!
    if (Math.abs(head[column]!) < 1e-14) {
      throw new RangeError('The CST fit is singular; the section has no interior points.')
    }
    for (let row = column + 1; row < n; row += 1) {
      const factor = a[row]![column]! / head[column]!
      if (factor === 0) continue
      for (let k = column; k <= n; k += 1) a[row]![k]! -= factor * head[k]!
    }
  }

  const solution = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row]![n]!
    for (let column = row + 1; column < n; column += 1) sum -= a[row]![column]! * solution[column]!
    solution[row] = sum / a[row]![row]!
  }
  return solution
}

/** A NACA four-digit section as the twelve CST weights the rest of the app works in. */
export function nacaSection(parameters: NacaParameters): Section {
  const { upper, lower } = nacaSurfaces(parameters)
  return { upper: fitCstWeights(upper), lower: fitCstWeights(lower) }
}
