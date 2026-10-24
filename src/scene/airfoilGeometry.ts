/**
 * Builds the extruded section mesh.
 *
 * The flow is solved in the x-y plane; the span is purely visual, so the mesh is the section loop
 * extruded along z with flat caps. Geometry is rebuilt on every weight change, which is why this
 * writes into preallocated arrays rather than going through `ExtrudeGeometry`: the budget is 16 ms
 * per slider frame and allocation churn is the first thing to break it.
 */

import { BufferAttribute, BufferGeometry } from 'three'

import { type Point, sectionLoop } from '../geometry/cst'
import type { Section } from '../geometry/shapeOps'

export interface AirfoilGeometryOptions {
  readonly panelCount?: number
  readonly span?: number
}

/**
 * Vertex layout: the loop is emitted twice, once per span face, and the side wall is a quad strip
 * between them. Caps are triangle fans from the mid-chord point, which is inside every valid
 * section because the validity filters reject crossing surfaces.
 */
export function buildAirfoilGeometry(
  section: Section,
  options: AirfoilGeometryOptions = {},
): BufferGeometry {
  const { panelCount = 160, span = 0.6 } = options
  const loop = sectionLoop(section.upper, section.lower, panelCount)
  const points = loop.slice(0, -1)
  const count = points.length
  const half = span / 2

  const vertexCount = count * 2 + 2
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  // The chordwise station travels in `uv.x`, which the pressure colormap samples in M5.
  const uvs = new Float32Array(vertexCount * 2)
  // Which surface a vertex belongs to, 0 for upper and 1 for lower. The pressure shader needs it
  // to index the right half of the 128-entry array, and it cannot be derived from the position
  // once the section is rotated by incidence.
  const surfaces = new Float32Array(vertexCount)

  const write = (
    index: number,
    point: Point,
    z: number,
    normal: readonly number[],
    surface: number,
  ): void => {
    positions[index * 3] = point.x
    positions[index * 3 + 1] = point.z
    positions[index * 3 + 2] = z
    normals[index * 3] = normal[0]!
    normals[index * 3 + 1] = normal[1]!
    normals[index * 3 + 2] = normal[2]!
    uvs[index * 2] = point.x
    uvs[index * 2 + 1] = index < count ? 0 : 1
    surfaces[index] = surface
  }

  // The loop runs trailing edge, upper surface, nose, lower surface, so the first half is upper.
  const noseIndex = panelCount / 2

  for (let i = 0; i < count; i += 1) {
    const surface = i <= noseIndex ? 0 : 1
    const previous = points[(i - 1 + count) % count]!
    const next = points[(i + 1) % count]!
    // Outward normal of the averaged edge direction. The loop is counter-clockwise, so rotating
    // the tangent by -90 degrees points out of the body.
    const tangentX = next.x - previous.x
    const tangentZ = next.z - previous.z
    const length = Math.hypot(tangentX, tangentZ) || 1
    const normal = [tangentZ / length, -tangentX / length, 0] as const
    write(i, points[i]!, -half, normal, surface)
    write(i + count, points[i]!, half, normal, surface)
  }

  const frontCentre = vertexCount - 2
  const backCentre = vertexCount - 1
  write(frontCentre, { x: 0.5, z: 0 }, -half, [0, 0, -1], 0)
  write(backCentre, { x: 0.5, z: 0 }, half, [0, 0, 1], 0)

  const indices: number[] = []
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count
    // Side wall.
    indices.push(i, next, i + count)
    indices.push(next, next + count, i + count)
    // Caps.
    indices.push(frontCentre, next, i)
    indices.push(backCentre, i + count, next + count)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('aSurface', new BufferAttribute(surfaces, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}
