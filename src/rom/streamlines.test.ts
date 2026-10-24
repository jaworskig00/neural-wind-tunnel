import { describe, expect, it } from 'vitest'

import { FIELD_HEIGHT, FIELD_WIDTH, FIELD_X_RANGE } from './podAtlas'
import { integrateStreamlines } from './streamlines'

/** A field with a constant velocity, as the renderer would hand it back: RGBA floats. */
function uniformField(u: number, v: number): Float32Array {
  const field = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT * 4)
  for (let i = 0; i < FIELD_WIDTH * FIELD_HEIGHT; i += 1) {
    field[i * 4] = u
    field[i * 4 + 1] = v
  }
  return field
}

const nothingInside = (): boolean => false

describe('integrateStreamlines', () => {
  it('follows a uniform flow straight downstream', () => {
    const { positions, lengths } = integrateStreamlines(uniformField(1, 0), nothingInside, {
      count: 4,
    })
    expect(lengths.length).toBe(4)

    // Every point of the first curve sits on the line it started on.
    const startY = positions[1]
    for (let i = 0; i < lengths[0]!; i += 1) {
      expect(positions[i * 3 + 1]).toBeCloseTo(startY!, 6)
      if (i > 0) expect(positions[i * 3]!).toBeGreaterThan(positions[(i - 1) * 3]!)
    }
  })

  it('follows an inclined flow at its own angle', () => {
    const angle = Math.PI / 6
    const { positions, lengths } = integrateStreamlines(
      uniformField(Math.cos(angle), Math.sin(angle)),
      nothingInside,
      { count: 1, spread: [0.1, 0.1] },
    )
    const last = lengths[0]! - 1
    const dx = positions[last * 3]! - positions[0]!
    const dy = positions[last * 3 + 1]! - positions[1]!
    expect(Math.atan2(dy, dx)).toBeCloseTo(angle, 3)
  })

  it('starts every curve at the inlet', () => {
    const { positions, lengths } = integrateStreamlines(uniformField(1, 0), nothingInside, {
      count: 5,
    })
    let offset = 0
    for (const length of lengths) {
      expect(positions[offset * 3]).toBeCloseTo(FIELD_X_RANGE[0] + 0.01, 6)
      offset += length
    }
  })

  it('stops at the body rather than threading through it', () => {
    const insideSquare = (x: number, y: number): boolean => x > 0 && x < 0.5 && y > -0.2 && y < 0.2
    const { positions, lengths } = integrateStreamlines(uniformField(1, 0), insideSquare, {
      count: 1,
      spread: [0.5, 0.5],
    })
    const last = lengths[0]! - 1
    expect(positions[last * 3]!).toBeLessThan(0.02)
  })

  it('stops where the flow stagnates instead of wandering', () => {
    const { lengths } = integrateStreamlines(uniformField(0, 0), nothingInside, { count: 3 })
    // A zero field gives one point per curve, and a single point is not a curve.
    expect(lengths).toEqual([])
  })

  it('spreads the rake across the inlet', () => {
    const { positions, lengths } = integrateStreamlines(uniformField(1, 0), nothingInside, {
      count: 6,
    })
    const starts: number[] = []
    let offset = 0
    for (const length of lengths) {
      starts.push(positions[offset * 3 + 1]!)
      offset += length
    }
    expect(starts.length).toBe(6)
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i]!).toBeGreaterThan(starts[i - 1]!)
    }
  })

  it('returns only the geometry it actually produced', () => {
    const { positions, lengths } = integrateStreamlines(uniformField(1, 0), nothingInside, {
      count: 8,
    })
    const total = lengths.reduce((sum, length) => sum + length, 0)
    expect(positions.length).toBe(total * 3)
  })
})
