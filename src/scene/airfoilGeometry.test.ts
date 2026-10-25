import { describe, expect, it } from 'vitest'

import { PRESETS } from '../geometry/presets'
import { stationIndexFromChord } from '../geometry/stations'
import { buildAirfoilGeometry } from './airfoilGeometry'

const section = { upper: PRESETS[2]!.upper, lower: PRESETS[2]!.lower }

describe('buildAirfoilGeometry', () => {
  it('gives the wall and the caps vertices of their own', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 160 })
    const positions = geometry.getAttribute('position')
    // Two rings for the wall and one for each cap: they carry different normals and mean
    // different things, so they cannot be the same vertices.
    expect(positions.count).toBe(160 * 4)
  })

  it('marks the caps as carrying no pressure', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 40 })
    const isSurface = geometry.getAttribute('aIsSurface')
    const normals = geometry.getAttribute('normal')
    let wall = 0
    let cut = 0
    for (let index = 0; index < isSurface.count; index += 1) {
      const spanwise = Math.abs(normals.getZ(index)) > 0.5
      if (isSurface.getX(index) === 1) {
        wall += 1
        // A vertex that claims a pressure must face out of the section, not along the span.
        expect(spanwise, `vertex ${String(index)} faces along the span`).toBe(false)
      } else {
        cut += 1
        expect(spanwise, `cut vertex ${String(index)} does not face along the span`).toBe(true)
      }
    }
    expect(wall).toBe(40 * 2)
    expect(cut).toBe(40 * 2)
  })

  it('carries the station index the pressure texture is addressed by', () => {
    const geometry = buildAirfoilGeometry(section, { panelCount: 40 })
    const uv = geometry.getAttribute('uv')
    const station = geometry.getAttribute('aStation')
    for (let index = 0; index < station.count; index += 1) {
      expect(station.getX(index)).toBeCloseTo(stationIndexFromChord(uv.getX(index)), 5)
    }
    // Which is the whole range of the 64 stations, leading edge to trailing edge.
    const values = Array.from({ length: station.count }, (_, i) => station.getX(i))
    expect(Math.min(...values)).toBeCloseTo(0, 5)
    expect(Math.max(...values)).toBeCloseTo(63, 5)
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
    // Two wall triangles per panel, plus four cap triangles per rung of the ladder and half as
    // many rungs as panels.
    expect(index!.count).toBe((40 * 2 + 20 * 4) * 3)
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
