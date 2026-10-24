/**
 * Streamlines through the reconstructed velocity field.
 *
 * Particles show where the flow goes; streamlines show its shape, and the two answer different
 * questions. A streamline is a curve everywhere tangent to the velocity, so it is an integration,
 * and this one runs on the CPU rather than the GPU.
 *
 * That is deliberate. The field is 192 by 96, which is 74 kB to read back, and it only changes when
 * the prediction does -- a few times a second at most, while dragging. Integrating a hundred curves
 * through it costs well under a millisecond. Doing it on the GPU would mean a transform-feedback
 * pass or a vertex-shader march to produce geometry that then has to be drawn anyway, for work that
 * does not appear in a frame budget.
 */

import { FIELD_HEIGHT, FIELD_WIDTH, FIELD_X_RANGE, FIELD_Y_RANGE } from './podAtlas'

/** Integration step, in chords. Small enough that a curve rounding the nose does not cut it. */
const STEP = 0.012

/** Points per curve. Long enough to cross the domain, short enough to stay cheap. */
const MAX_POINTS = 260

/** Speed below which integration stops: a stagnation region is not a direction. */
const MIN_SPEED = 1e-3

export interface StreamlineOptions {
  /** Curves released across the inlet. */
  readonly count?: number
  /** Where along the inlet face the rake starts and ends, as a fraction of the domain height. */
  readonly spread?: readonly [number, number]
}

export interface Streamlines {
  /** Flat `[x, y, z]` triples, one contiguous run per curve. */
  readonly positions: Float32Array
  /** Number of points in each curve, in order. */
  readonly lengths: number[]
}

/** Bilinear sample of the field, clamped at the edges. */
function sample(field: Float32Array, x: number, y: number): [number, number] {
  const u = ((x - FIELD_X_RANGE[0]) / (FIELD_X_RANGE[1] - FIELD_X_RANGE[0])) * (FIELD_WIDTH - 1)
  const v = ((y - FIELD_Y_RANGE[0]) / (FIELD_Y_RANGE[1] - FIELD_Y_RANGE[0])) * (FIELD_HEIGHT - 1)

  const x0 = Math.min(Math.max(Math.floor(u), 0), FIELD_WIDTH - 1)
  const y0 = Math.min(Math.max(Math.floor(v), 0), FIELD_HEIGHT - 1)
  const x1 = Math.min(x0 + 1, FIELD_WIDTH - 1)
  const y1 = Math.min(y0 + 1, FIELD_HEIGHT - 1)
  const fx = Math.min(Math.max(u - x0, 0), 1)
  const fy = Math.min(Math.max(v - y0, 0), 1)

  const at = (ix: number, iy: number): [number, number] => {
    const index = (iy * FIELD_WIDTH + ix) * 4
    return [field[index] ?? 0, field[index + 1] ?? 0]
  }

  const [ax, ay] = at(x0, y0)
  const [bx, by] = at(x1, y0)
  const [cx, cy] = at(x0, y1)
  const [dx, dy] = at(x1, y1)

  const top = [ax + (bx - ax) * fx, ay + (by - ay) * fx] as const
  const bottom = [cx + (dx - cx) * fx, cy + (dy - cy) * fx] as const
  return [top[0] + (bottom[0] - top[0]) * fy, top[1] + (bottom[1] - top[1]) * fy]
}

/**
 * Integrates streamlines from a rake across the inlet.
 *
 * `field` is the render target read back as RGBA floats, `u` in red and `v` in green. `inside` says
 * whether a point is in the body, so a curve stops at the surface instead of threading through it.
 */
export function integrateStreamlines(
  field: Float32Array,
  inside: (x: number, y: number) => boolean,
  { count = 96, spread = [0.04, 0.96] }: StreamlineOptions = {},
): Streamlines {
  const positions = new Float32Array(count * MAX_POINTS * 3)
  const lengths: number[] = []
  let cursor = 0

  for (let index = 0; index < count; index += 1) {
    const fraction = spread[0] + ((spread[1] - spread[0]) * index) / Math.max(count - 1, 1)
    let x = FIELD_X_RANGE[0] + 0.01
    let y = FIELD_Y_RANGE[0] + (FIELD_Y_RANGE[1] - FIELD_Y_RANGE[0]) * fraction
    let points = 0

    for (let step = 0; step < MAX_POINTS; step += 1) {
      if (x > FIELD_X_RANGE[1] || y < FIELD_Y_RANGE[0] || y > FIELD_Y_RANGE[1]) break
      if (inside(x, y)) break

      positions[cursor] = x
      positions[cursor + 1] = y
      positions[cursor + 2] = 0
      cursor += 3
      points += 1

      // Second-order Runge-Kutta, for the same reason the particles use it: a first-order step
      // cuts the corner at the leading edge and walks into the body.
      const [ux, uy] = sample(field, x, y)
      const speed = Math.hypot(ux, uy)
      if (speed < MIN_SPEED) break

      const midX = x + 0.5 * STEP * (ux / speed)
      const midY = y + 0.5 * STEP * (uy / speed)
      const [mx, my] = sample(field, midX, midY)
      const midSpeed = Math.hypot(mx, my)
      if (midSpeed < MIN_SPEED) break

      x += STEP * (mx / midSpeed)
      y += STEP * (my / midSpeed)
    }

    if (points > 1) {
      lengths.push(points)
    } else {
      // A curve of one point is not a curve; rewind so the buffer holds only real geometry.
      cursor -= points * 3
    }
  }

  return { positions: positions.subarray(0, cursor), lengths }
}
