import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'

import { BodyMask } from '../gpgpu/bodyMask'
import { FrameProbe } from '../gpgpu/frameProbe'
import { ParticleField } from '../gpgpu/particles'
import { TrailBuffer } from '../gpgpu/trails'
import { StreamlineRibbons } from './StreamlineRibbons'
import type { Prediction } from '../ml/types'
import { podAtlasUrl } from '../ml/sources'
import {
  type GpuCapabilities,
  type Tier,
  type TierReport,
  initialTier,
  tierByName,
} from '../rom/capabilities'
import { type PodAtlas, loadPodAtlas } from '../rom/podAtlas'
import { FieldReconstruction } from '../rom/reconstruction'
import { usePrefersReducedMotion } from '../app/useReducedMotion'
import { useAppStore } from '../state/store'

/**
 * The flow field: reconstruct, advect, draw.
 *
 * Three stages run here each frame, in this order and for this reason. The field is rebuilt only
 * when the prediction changes, because nothing moves it otherwise. The body mask is rebuilt only
 * when the shape changes. The particles step every frame, because that is the only thing that is
 * actually animating.
 *
 * Everything is in the section frame, where the body is axis-aligned and the flow arrives at the
 * angle of attack. The group rotates by the negative of that angle, which puts the freestream
 * horizontal on screen without a single rotation inside the simulation.
 */

export interface FlowFieldProps {
  readonly prediction: Prediction | null
  readonly capabilities: GpuCapabilities
  /** Called whenever the running tier changes, so the UI can report what is actually being drawn. */
  readonly onTier?: (report: TierReport) => void
}

export function FlowField({ prediction, capabilities, onTier }: FlowFieldProps) {
  const renderer = useThree((state) => state.gl)
  const section = useAppStore((state) => state.section)
  const alphaDeg = useAppStore((state) => state.alphaDeg)
  const colormap = useAppStore((state) => state.colormap)
  const view = useAppStore((state) => state.view)
  const trailIntensity = useAppStore((state) => state.trailIntensity)
  const tierChoice = useAppStore((state) => state.tier)
  const motion = useAppStore((state) => state.motion)
  const reduced = usePrefersReducedMotion()

  /**
   * Whether the particles may move.
   *
   * Reduced motion is a request from the person at the keyboard, not a hint, so it wins unless they
   * have said otherwise in the panel. A paused particle cloud is noise rather than information, so
   * the streamlines come up in its place: the same field, standing still.
   */
  const animate = motion === 'always' || !reduced

  const [atlas, setAtlas] = useState<PodAtlas | null>(null)
  const startingTier = useMemo(
    () => (tierChoice === 'auto' ? initialTier(capabilities) : tierByName(tierChoice)),
    [capabilities, tierChoice],
  )
  /**
   * The tier actually running.
   *
   * Derived rather than mirrored: the probe's choice is held as an override of the starting guess,
   * so changing the guess -- by picking a tier by hand, or by the capability check -- clears it
   * without an effect that writes state during render.
   */
  const [override, setOverride] = useState<{ from: Tier; to: Tier } | null>(null)
  const tier = override?.from === startingTier ? override.to : startingTier

  // The probe is created inside the frame callback rather than during render: a ref may be written
  // from a callback but not while rendering, and the first frame is the earliest it is needed.
  const probe = useRef<FrameProbe | null>(null)
  const probeKey = useRef<Tier | null>(null)

  useEffect(() => {
    let cancelled = false
    let loaded: PodAtlas | null = null
    loadPodAtlas(podAtlasUrl(), capabilities.floatLinear)
      .then((result) => {
        if (cancelled) {
          result.dispose()
          return
        }
        loaded = result
        setAtlas(result)
      })
      .catch((error: unknown) => {
        // Without the atlas there is no field. The surface pressure and the charts still work, so
        // this degrades rather than fails.
        console.warn('Could not load the mode atlas; the flow field is unavailable', error)
      })
    return () => {
      cancelled = true
      loaded?.dispose()
    }
  }, [capabilities.floatLinear])

  const size = useThree((state) => state.size)

  /**
   * The GPU stages, held in a ref rather than memoised.
   *
   * These are imperative objects with their own lifetime: render targets, textures, a scene of
   * their own. React does not need to track their identity to decide what to draw, and holding
   * them in a `useMemo` would mean mutating a memoised value every frame, which the compiler rules
   * rightly forbid. A ref says what they are: state that lives alongside React rather than in it.
   */
  const stages = useRef<{
    field: FieldReconstruction
    mask: BodyMask
    particles: ParticleField
    trails: TrailBuffer
  } | null>(null)

  useEffect(() => {
    if (!atlas) return

    const particles = new ParticleField({ tier, precision: capabilities.precision })
    const trails = new TrailBuffer({
      width: Math.max(1, Math.floor(size.width)),
      height: Math.max(1, Math.floor(size.height)),
      precision: capabilities.precision,
    })
    particles.points.position.set(-0.5, 0, 0)
    trails.setParticles(particles.points)
    particles.reset(renderer)

    const built = {
      field: new FieldReconstruction(atlas, capabilities.precision),
      mask: new BodyMask(),
      particles,
      trails,
    }
    stages.current = built
    onTier?.({ tier, medianFrameMs: 0, automatic: tierChoice === 'auto' })

    return () => {
      stages.current = null
      built.field.dispose()
      built.mask.dispose()
      built.particles.dispose()
      built.trails.dispose()
    }
    // `size` is deliberately excluded: a resize is handled below, not by rebuilding every stage
    // and losing the simulation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas, capabilities.precision, tier, renderer, onTier, tierChoice])

  // The field depends on the prediction; rebuilding it on anything else would be wasted work.
  useEffect(() => {
    if (!atlas || !prediction) return
    stages.current?.field.update(renderer, prediction.pod, alphaDeg)
  }, [atlas, prediction, alphaDeg, renderer])

  useEffect(() => {
    if (!atlas) return
    stages.current?.mask.update(renderer, section)
  }, [atlas, section, renderer])

  useEffect(() => {
    if (!atlas) return
    stages.current?.particles.setColormap(colormap === 'cividis' ? 1 : 0)
  }, [atlas, colormap])

  useEffect(() => {
    if (!atlas) return
    stages.current?.trails.setIntensity(trailIntensity)
  }, [atlas, trailIntensity])

  useEffect(() => {
    if (!atlas) return
    stages.current?.trails.resize(
      Math.max(1, Math.floor(size.width)),
      Math.max(1, Math.floor(size.height)),
      capabilities.precision,
    )
  }, [atlas, size.width, size.height, capabilities.precision])

  /**
   * The frame.
   *
   * A positive priority means react-three-fiber hands over the render loop entirely: its own
   * automatic `render` call stops, and this callback is responsible for drawing the scene. That is
   * exactly what is wanted here -- the trails have to composite over the scene, which means the
   * scene must be drawn first, by us, in a known order -- but it is easy to miss, and missing it
   * leaves the scene undrawn while the composite accumulates onto an uncleared buffer. The symptom
   * was a uniformly white frame that survived every attempt to turn the trails down.
   *
   * Incidence is applied here rather than in an effect: the particles live in a scene of their own
   * so they can be drawn into the trail buffer, so there is no scene-graph parent to rotate.
   */
  useFrame(({ camera, scene }, delta) => {
    const current = stages.current
    if (!current) {
      renderer.render(scene, camera)
      return
    }

    current.particles.points.rotation.z = (-alphaDeg * Math.PI) / 180
    renderer.render(scene, camera)

    if (!animate || view === 'surface' || view === 'streamlines') return
    current.particles.step(renderer, delta, current.field.texture, current.mask.texture)
    current.trails.accumulate(renderer, camera, delta)
    current.trails.draw(renderer)

    if (probeKey.current !== startingTier) {
      probeKey.current = startingTier
      const created = new FrameProbe(startingTier.name)
      if (tierChoice !== 'auto') created.freeze()
      probe.current = created
    }

    const decision = probe.current?.record(delta)
    if (decision?.changed) {
      setOverride({ from: startingTier, to: decision.tier })
      onTier?.({ tier: decision.tier, medianFrameMs: decision.medianFrameMs, automatic: true })
    }
  }, 1)

  const showStreamlines =
    view === 'streamlines' || view === 'both' || (!animate && view === 'particles')

  return showStreamlines ? (
    <StreamlineRibbons
      stages={stages}
      section={section}
      alphaDeg={alphaDeg}
      prediction={prediction}
    />
  ) : null
}
