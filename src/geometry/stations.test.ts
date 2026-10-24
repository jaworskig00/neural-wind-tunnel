import { describe, expect, it } from 'vitest'

import { CP_STATIONS_PER_SURFACE, CP_STATION_COUNT, cpStationAt, cpStations } from './stations'

/**
 * These assertions encode the contract in `docs/DATASET-SCHEMA.md` section 3. If one of them
 * fails, either the schema changed deliberately -- in which case the version is bumped and the
 * dataset is regenerated -- or a pressure plot is about to be silently misaligned.
 */
describe('cp surface stations', () => {
  const stations = cpStations()

  it('has one station per dataset column', () => {
    expect(stations).toHaveLength(CP_STATIONS_PER_SURFACE)
    expect(CP_STATION_COUNT).toBe(128)
  })

  it('spans the chord exactly, leading edge to trailing edge', () => {
    expect(stations[0]).toBe(0)
    expect(stations[CP_STATIONS_PER_SURFACE - 1]).toBeCloseTo(1, 12)
  })

  it('increases monotonically', () => {
    for (let j = 1; j < stations.length; j += 1) {
      expect(stations[j]!).toBeGreaterThan(stations[j - 1]!)
    }
  })

  it('clusters toward both edges, which is the point of the cosine spacing', () => {
    const gaps = Array.from(
      { length: stations.length - 1 },
      (_, j) => stations[j + 1]! - stations[j]!,
    )
    const first = gaps[0]!
    const middle = gaps[Math.floor(gaps.length / 2)]!
    const last = gaps[gaps.length - 1]!

    expect(first).toBeLessThan(middle / 4)
    expect(last).toBeLessThan(middle / 4)
    // Symmetric about mid-chord.
    expect(first).toBeCloseTo(last, 12)
  })

  it('matches the closed form from the schema', () => {
    const last = CP_STATIONS_PER_SURFACE - 1
    for (let j = 0; j <= last; j += 1) {
      expect(stations[j]!).toBeCloseTo(0.5 * (1 - Math.cos((Math.PI * j) / last)), 15)
    }
  })
})

describe('cpStationAt', () => {
  it('maps the first half to the upper surface and the second to the lower', () => {
    expect(cpStationAt(0)).toEqual({ surface: 'upper', x: 0 })
    expect(cpStationAt(CP_STATIONS_PER_SURFACE)).toEqual({ surface: 'lower', x: 0 })
    expect(cpStationAt(CP_STATION_COUNT - 1).surface).toBe('lower')
    expect(cpStationAt(CP_STATION_COUNT - 1).x).toBeCloseTo(1, 12)
  })

  it('agrees with the per-surface station list', () => {
    const stations = cpStations()
    for (let j = 0; j < CP_STATIONS_PER_SURFACE; j += 1) {
      expect(cpStationAt(j).x).toBe(stations[j])
      expect(cpStationAt(j + CP_STATIONS_PER_SURFACE).x).toBe(stations[j])
    }
  })

  it('rejects indices outside the column range', () => {
    expect(() => cpStationAt(-1)).toThrow(RangeError)
    expect(() => cpStationAt(CP_STATION_COUNT)).toThrow(RangeError)
    expect(() => cpStationAt(1.5)).toThrow(RangeError)
  })
})
