import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'

import { FlowField } from './FlowField'
import type { Prediction } from '../ml/types'
import { type GpuCapabilities, type TierReport, detectCapabilities } from '../rom/capabilities'
import { useAppStore } from '../state/store'
import { buildAirfoilGeometry } from './airfoilGeometry'
import { createPressureMaterial } from './pressureMaterial'

/**
 * The section mesh, coloured by the predicted surface pressure.
 *
 * Geometry is rebuilt whenever the weights change; the builder writes into preallocated typed arrays
 * so a slider drag stays inside the 16 ms budget. The material is built once and its pressure
 * texture is rewritten per prediction, which is 128 floats rather than a new vertex attribute.
 */
function AirfoilMesh({ prediction }: { readonly prediction: Prediction | null }) {
  const section = useAppStore((state) => state.section)
  const alphaDeg = useAppStore((state) => state.alphaDeg)
  const colormap = useAppStore((state) => state.colormap)

  const geometry = useMemo(() => buildAirfoilGeometry(section), [section])
  const pressure = useMemo(() => createPressureMaterial(colormap), [colormap])

  useEffect(
    () => () => {
      pressure.dispose()
    },
    [pressure],
  )
  useEffect(() => {
    if (prediction) pressure.update(prediction.cp)
  }, [prediction, pressure])

  return (
    <group rotation={[0, 0, (-alphaDeg * Math.PI) / 180]} position={[-0.5, 0, 0]}>
      <mesh geometry={geometry} material={pressure.material} />
    </group>
  )
}

/**
 * Incidence is applied by rotating the section rather than the freestream, which is the opposite
 * of what the solver does. It is the right choice for the camera: the flow visualisation in M6
 * reads from a field aligned with the world x axis, so the freestream must stay put.
 */
export interface ViewportProps {
  readonly prediction: Prediction | null
  readonly onTier?: (report: TierReport) => void
}

export function Viewport({ prediction, onTier }: ViewportProps) {
  // Probed once, before the scene exists, so the flow field never has to discover mid-frame that
  // the hardware cannot do what it assumed.
  const capabilities = useMemo<GpuCapabilities>(() => detectCapabilities(), [])

  return (
    <Canvas
      // Close to side-on, lifted just enough to read as three-dimensional. An oblique default
      // makes the section look like a wing panel and hides the profile, which is the thing a
      // reviewer is here to look at.
      camera={{ position: [0.15, 0.28, 1.75], fov: 38 }}
      dpr={[1, 2]}
      // `preserveDrawingBuffer` is on deliberately: without it a WebGL canvas composites as
      // empty in screenshots, and the Playwright captures in T4.5 and T9.2 are part of the
      // deliverable. The cost is one buffer copy per frame, which is immaterial here.
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      data-testid="viewport"
      // The canvas is the result, so it gets a description rather than being left as an unlabelled
      // graphic. The numbers it visualises are also in the header and the charts, which is where a
      // screen reader user actually reads them.
      role="img"
      aria-label="Three-dimensional view of the section with the predicted flow field. The same numbers are in the coefficient header and the charts."
    >
      <color attach="background" args={['#080c11']} />
      <hemisphereLight args={['#dfe7ef', '#0b1118', 0.75]} />
      <directionalLight position={[2, 3, 2]} intensity={1.6} />
      <directionalLight position={[-2, -1, -2]} intensity={0.35} color="#8ab4f8" />

      <AirfoilMesh prediction={prediction} />
      <FlowField
        prediction={prediction}
        capabilities={capabilities}
        {...(onTier ? { onTier } : {})}
      />

      <Grid
        args={[8, 8]}
        position={[0, -0.45, 0]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor="#22303d"
        sectionSize={0.5}
        sectionThickness={1}
        sectionColor="#2d3d4d"
        fadeDistance={7}
        fadeStrength={1.4}
        infiniteGrid
      />

      <OrbitControls
        enablePan={false}
        minDistance={0.8}
        maxDistance={5}
        maxPolarAngle={Math.PI * 0.85}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}
