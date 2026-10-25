/**
 * Builds the extruded section mesh.
 *
 * The flow is solved in the x-y plane; the span is purely visual, so the mesh is the section loop
 * extruded along z with flat caps. Geometry is rebuilt on every weight change, which is why this
 * writes into preallocated arrays rather than going through `ExtrudeGeometry`: the budget is 16 ms
 * per slider frame and allocation churn is the first thing to break it.
 *
 * The wall and the caps are different surfaces and do not share vertices: they need different
 * normals, the wall's pointing out of the section and the caps' along the span, and `aIsSurface`
 * tells the shader which it is looking at.
 *
 * The caps are triangulated as a ladder between the two surfaces at matching chord, not as a fan
 * from a centre point. A fan has every triangle meeting at mid-chord, so the chordwise coordinate
 * collapses to 0.5 in the middle of the section and the cut comes out painted with a fan of
 * contours radiating from a point that means nothing. A ladder keeps chord running along the
 * section and the surface blend running across it, which is what a cut through the body actually
 * looks like.
 */

import { BufferAttribute, BufferGeometry } from 'three'

import { type Point, sectionLoop } from '../geometry/cst'
import { stationIndexFromChord } from '../geometry/stations'
import type { Section } from '../geometry/shapeOps'

export interface AirfoilGeometryOptions {
  readonly panelCount?: number
  readonly span?: number
}

export function buildAirfoilGeometry(
  section: Section,
  options: AirfoilGeometryOptions = {},
): BufferGeometry {
  const { panelCount = 160, span = 0.6 } = options
  const loop = sectionLoop(section.upper, section.lower, panelCount)
  const points = loop.slice(0, -1)
  const count = points.length
  const half = span / 2

  // The wall is two rings of `count`, and each cap reuses a ring of its own.
  const wallCount = count * 2
  const vertexCount = wallCount + 2 * count

  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  // The chordwise station travels in `uv.x`, which the pressure colormap samples.
  const uvs = new Float32Array(vertexCount * 2)
  // Which surface a vertex belongs to, 0 for upper and 1 for lower. The pressure shader needs it
  // to pick the right row of the pressure texture, and it cannot be derived from the position once
  // the section is rotated by incidence.
  const surfaces = new Float32Array(vertexCount)
  // 1 where the solver computed a pressure, 0 on the span-wise cut.
  const isSurface = new Float32Array(vertexCount)
  // The fractional station index, so the shader interpolates it rather than re-deriving it.
  const stations = new Float32Array(vertexCount)

  const write = (
    index: number,
    point: Point,
    z: number,
    normal: readonly [number, number, number],
    surface: number,
    surfaceFlag: number,
  ): void => {
    positions[index * 3] = point.x
    positions[index * 3 + 1] = point.z
    positions[index * 3 + 2] = z
    normals[index * 3] = normal[0]
    normals[index * 3 + 1] = normal[1]
    normals[index * 3 + 2] = normal[2]
    uvs[index * 2] = point.x
    stations[index] = stationIndexFromChord(point.x)
    uvs[index * 2 + 1] = z > 0 ? 1 : 0
    surfaces[index] = surface
    isSurface[index] = surfaceFlag
  }

  // The loop runs trailing edge, upper surface, nose, lower surface, so the first half is upper.
  const noseIndex = panelCount / 2
  const frontRing = wallCount
  const backRing = wallCount + count

  for (let i = 0; i < count; i += 1) {
    const point = points[i]!
    const surface = i <= noseIndex ? 0 : 1
    const previous = points[(i - 1 + count) % count]!
    const next = points[(i + 1) % count]!
    // Outward normal of the averaged edge direction. The loop is counter-clockwise, so rotating
    // the tangent by -90 degrees points out of the body.
    const tangentX = next.x - previous.x
    const tangentZ = next.z - previous.z
    const length = Math.hypot(tangentX, tangentZ) || 1
    const normal = [tangentZ / length, -tangentX / length, 0] as const

    write(i, point, -half, normal, surface, 1)
    write(i + count, point, half, normal, surface, 1)
    write(frontRing + i, point, -half, [0, 0, -1], surface, 0)
    write(backRing + i, point, half, [0, 0, 1], surface, 0)
  }

  const indices: number[] = []
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count
    // Side wall.
    indices.push(i, next, i + count)
    indices.push(next, next + count, i + count)
  }

  /**
   * The caps, as a ladder between the surfaces.
   *
   * The loop runs trailing edge, up over the upper surface to the nose, then back along the lower
   * surface, so index `i` on the upper surface sits at the same chord as index `count - i` on the
   * lower. Pairing them walks two rungs at a time from the trailing edge to the nose and fills the
   * section without a fan.
   */
  for (let i = 0; i < noseIndex; i += 1) {
    const upper = i
    const lower = (count - i) % count
    const upperNext = i + 1
    const lowerNext = (count - i - 1) % count

    // Wound so each cap faces out along its own span direction: the ring at -z is seen from -z,
    // the ring at +z from +z, so the two run opposite ways round.
    indices.push(frontRing + upper, frontRing + lower, frontRing + lowerNext)
    indices.push(frontRing + upper, frontRing + lowerNext, frontRing + upperNext)
    indices.push(backRing + upper, backRing + lowerNext, backRing + lower)
    indices.push(backRing + upper, backRing + upperNext, backRing + lowerNext)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('aSurface', new BufferAttribute(surfaces, 1))
  geometry.setAttribute('aIsSurface', new BufferAttribute(isSurface, 1))
  geometry.setAttribute('aStation', new BufferAttribute(stations, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}
