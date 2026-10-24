/**
 * The pressure-mapped surface material.
 *
 * The 128 predicted pressure coefficients are uploaded as a one-row float texture and sampled in the
 * fragment shader, rather than being baked into vertex colours. Two reasons: the surface is sampled
 * per fragment, so the colour band edges stay sharp wherever the mesh is coarse, and updating a
 * prediction means writing 128 floats instead of rebuilding a vertex attribute.
 */

import { DataTexture, FloatType, NearestFilter, RedFormat, ShaderMaterial } from 'three'

import { CP_STATION_COUNT } from '../ml/types'
import fragmentShader from '../shaders/pressure.frag?raw'
import vertexShader from '../shaders/pressure.vert?raw'
import { resolveIncludes } from '../shaders/include'

export type ColormapName = 'coolwarm' | 'cividis'

const COLORMAP_INDEX: Readonly<Record<ColormapName, number>> = { coolwarm: 0, cividis: 1 }

/**
 * Fixed pressure range for the colour scale.
 *
 * Fixed, not auto-scaled: a scale that rescales itself as the shape changes makes two states
 * impossible to compare, which defeats the purpose. The range covers stagnation at the top and a
 * strong suction peak at the bottom; anything beyond it clamps, and the legend says so.
 */
export const PRESSURE_RANGE = { min: -4, max: 1 } as const

export interface PressureMaterialHandle {
  readonly material: ShaderMaterial
  /** Uploads a new prediction. Expects the 128 stations in dataset column order. */
  update: (cp: Float32Array) => void
  setColormap: (name: ColormapName) => void
  dispose: () => void
}

export function createPressureMaterial(
  colormap: ColormapName = 'coolwarm',
): PressureMaterialHandle {
  const data = new Float32Array(CP_STATION_COUNT)
  const texture = new DataTexture(data, CP_STATION_COUNT, 1, RedFormat, FloatType)
  // Nearest sampling on purpose: the shader computes the exact station index, so interpolating
  // between texels would blur the very values being read.
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.needsUpdate = true

  const material = new ShaderMaterial({
    vertexShader: resolveIncludes(vertexShader),
    fragmentShader: resolveIncludes(fragmentShader),
    uniforms: {
      uPressure: { value: texture },
      uPressureMin: { value: PRESSURE_RANGE.min },
      uPressureMax: { value: PRESSURE_RANGE.max },
      uColormap: { value: COLORMAP_INDEX[colormap] },
      uShadingStrength: { value: 0.35 },
    },
  })

  return {
    material,
    update(cp) {
      if (cp.length !== CP_STATION_COUNT) {
        throw new RangeError(`Expected ${CP_STATION_COUNT} pressure stations, got ${cp.length}`)
      }
      data.set(cp)
      texture.needsUpdate = true
    },
    setColormap(name) {
      material.uniforms['uColormap']!.value = COLORMAP_INDEX[name]
    },
    dispose() {
      texture.dispose()
      material.dispose()
    },
  }
}
