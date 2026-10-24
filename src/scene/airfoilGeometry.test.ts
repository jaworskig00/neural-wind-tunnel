import { describe, expect, it } from 'vitest'

import { PRESETS } from '../geometry/presets'
import { buildAirfoilGeometry } from './airfoilGeometry'

const section = { upper: PRESETS[2]!.upper, lower: PRESETS[2]!.lower }

describe('buildAirfoilGeometry', () => {
  it('emits the loop twice plus two cap centres', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 160 })
    const positions = geometry.getAttribute('position')
    expect(positions.count).toBe(160 * 2 + 2)
  })

  it('carries the chordwise station in uv.x', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 40 })
    const uv = geometry.getAttribute('uv')
    const stations = Array.from({ length: uv.count }, (_, index) => uv.getX(index))
    expect(Math.min(...stations)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...stations)).toBeLessThanOrEqual(1)
    // The trailing edge is where the loop starts and ends.
    expect(uv.getX(0)).toBeCloseTo(1, 6)
  })

  it('labels both surfaces, which the pressure shader indexes by', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 40 })
    const surface = geometry.getAttribute('aSurface')
    const values = new Set(Array.from({ length: surface.count }, (_, i) => surface.getX(i)))
    expect(values).toEqual(new Set([0, 1]))
  })

  it('puts the upper surface above the lower one', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 80 })
    const positions = geometry.getAttribute('position')
    const surface = geometry.getAttribute('aSurface')
    let upperSum = 0
    let lowerSum = 0
    for (let index = 0; index < positions.count - 2; index += 1) {
      if (surface.getX(index) === 0) upperSum += positions.getY(index)
      else lowerSum += positions.getY(index)
    }
    expect(upperSum).toBeGreaterThan(lowerSum)
  })

  it('spans the requested width', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 40, span: 1.2 })
    const positions = geometry.getAttribute('position')
    const z = Array.from({ length: positions.count }, (_, index) => positions.getZ(index))
    expect(Math.min(...z)).toBeCloseTo(-0.6, 6)
    expect(Math.max(...z)).toBeCloseTo(0.6, 6)
  })

  it('produces a watertight index buffer', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 40 })
    const index = geometry.getIndex()
    expect(index).not.toBeNull()
    // Four triangles per panel: two for the wall, one for each cap.
    expect(index!.count).toBe(40 * 4 * 3)
    const positions = geometry.getAttribute('position')
    for (let i = 0; i < index!.count; i += 1) {
      expect(index!.getX(i)).toBeLessThan(positions.count)
    }
  })

  it('gives every vertex a unit normal', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 40 })
    const normals = geometry.getAttribute('normal')
    for (let index = 0; index < normals.count; index += 1) {
      const length = Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index))
      expect(length).toBeCloseTo(1, 5)
    }
  })
})
