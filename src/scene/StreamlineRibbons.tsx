import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry, LineBasicMaterial } from 'three'

import { sectionLoop } from '../geometry/cst'
import type { Section } from '../geometry/shapeOps'
import type { Prediction } from '../ml/types'
import { FIELD_HEIGHT, FIELD_WIDTH } from '../rom/podAtlas'
import type { FieldReconstruction } from '../rom/reconstruction'
import { integrateStreamlines } from '../rom/streamlines'

/**
 * Streamlines, integrated on the CPU from the reconstructed field.
 *
 * The field is read back once per prediction -- 74 kB, a few times a second at most while dragging
 * -- and a hundred curves are integrated through it in well under a millisecond. The result needs
 * no per-frame work at all, which is the point: particles animate, streamlines simply are.
 *
 * All the curves go into one `LineSegments`, so the whole set is a single draw call rather than
 * ninety-six.
 */

export interface StreamlineRibbonsProps {
  /**
   * The GPU stages, as the ref that owns them.
   *
   * The ref itself is passed rather than its contents: reading `.current` during a parent's render
   * is exactly what the rule against it is for, and this component only ever needs the field inside
   * an effect, after the stages exist.
   */
  readonly stages: { readonly current: { readonly field: FieldReconstruction } | null }
  readonly section: Section
  readonly alphaDeg: number
  readonly prediction: Prediction | null
}

/** Crossing-number test against the section outline, so a curve stops at the surface. */
function makeInsideTest(section: Section): (x: number, y: number) => boolean {
  const loop = sectionLoop(section.upper, section.lower, 120)
  return (x, y) => {
    let inside = false
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
      const a = loop[i]
      const b = loop[j]
      if (!a || !b) continue
      if (a.z > y !== b.z > y && x < ((b.x - a.x) * (y - a.z)) / (b.z - a.z) + a.x) {
        inside = !inside
      }
    }
    return inside
  }
}

/** Turns runs of points into the pairs `LineSegments` wants. */
function toSegments(positions: Float32Array, lengths: number[]): Float32Array {
  const segmentCount = lengths.reduce((total, length) => total + Math.max(length - 1, 0), 0)
  const segments = new Float32Array(segmentCount * 6)
  let source = 0
  let target = 0
  for (const length of lengths) {
    for (let i = 0; i < length - 1; i += 1) {
      const a = (source + i) * 3
      const b = (source + i + 1) * 3
      segments[target] = positions[a] ?? 0
      segments[target + 1] = positions[a + 1] ?? 0
      segments[target + 2] = 0
      segments[target + 3] = positions[b] ?? 0
      segments[target + 4] = positions[b + 1] ?? 0
      segments[target + 5] = 0
      target += 6
    }
    source += length
  }
  return segments
}

export function StreamlineRibbons({
  stages,
  section,
  alphaDeg,
  prediction,
}: StreamlineRibbonsProps) {
  const renderer = useThree((state) => state.gl)

  const material = useMemo(
    () =>
      new LineBasicMaterial({
        color: 0x9fc3ff,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    [],
  )
  useEffect(
    () => () => {
      material.dispose()
    },
    [material],
  )

  /**
   * The geometry, in state rather than mutated onto a long-lived object.
   *
   * A whole new geometry per prediction, not a new attribute on the old one: replacing an attribute
   * on a geometry three has already uploaded does not reliably invalidate what the driver holds,
   * and the symptom is 96 curves and 21 000 points that exist in memory and never appear on screen.
   * One extra render per prediction is the price, and the prediction changing re-renders this
   * component anyway.
   */
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  useEffect(
    () => () => {
      geometry?.dispose()
    },
    [geometry],
  )

  // What the current geometry was built from, so it is rebuilt when, and only when, that changes.
  const built = useRef<{ prediction: Prediction | null; section: Section } | null>(null)
  const pixels = useMemo(() => new Float32Array(FIELD_WIDTH * FIELD_HEIGHT * 4), [])

  /**
   * Rebuilt in the frame loop rather than in an effect.
   *
   * A child's effects run before its parent's, so on the first mount the parent has not yet created
   * the GPU stages -- and because the stages arrive on a ref, nothing re-triggers the effect when
   * they do. The frame loop has no such ordering problem: it simply looks, every frame, and acts
   * when there is something to act on. Priority 0.5 so this runs before the parent's render at 1.
   */
  useFrame(() => {
    const field = stages.current?.field
    if (!field || !prediction) return
    if (built.current?.prediction === prediction && built.current.section === section) return

    try {
      renderer.readRenderTargetPixels(field.debugTarget, 0, 0, FIELD_WIDTH, FIELD_HEIGHT, pixels)
    } catch {
      // Without a readable field there are no streamlines; the particles still work.
      return
    }

    const { positions, lengths } = integrateStreamlines(pixels, makeInsideTest(section))

    const next = new BufferGeometry()
    next.setAttribute('position', new BufferAttribute(toSegments(positions, lengths), 3))
    next.computeBoundingSphere()
    built.current = { prediction, section }
    setGeometry(next)
  }, 0.5)

  return (
    <group rotation={[0, 0, (-alphaDeg * Math.PI) / 180]} position={[-0.5, 0, 0]}>
      {geometry && (
        <lineSegments frustumCulled={false} material={material}>
          <primitive object={geometry} attach="geometry" />
        </lineSegments>
      )}
    </group>
  )
}
