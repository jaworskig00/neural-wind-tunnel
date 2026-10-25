/**
 * The pressure-mapped surface material.
 *
 * The 128 predicted pressure coefficients are uploaded as a float texture and sampled in the
 * fragment shader, rather than being baked into vertex colours. Two reasons: the surface is sampled
 * per fragment, so the colour stays smooth wherever the mesh is coarse, and updating a prediction
 * means writing 128 floats instead of rebuilding a vertex attribute.
 *
 * Two rows of 64 rather than one row of 128. The 128 values are two separate functions of chord --
 * one per surface -- laid end to end, and a filter that interpolates across the join would blend
 * the upper surface's trailing edge into the lower surface's leading edge, which are at opposite
 * ends of the section and usually at opposite ends of the colour scale. With a row each, the
 * hardware interpolates along the chord and never between surfaces.
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  RedFormat,
  ShaderMaterial,
} from 'three'

import { CP_STATIONS_PER_SURFACE, CP_STATION_COUNT } from '../ml/types'
import { COLORMAP_INDEX, type ColormapName, PRESSURE_RANGE } from './pressureScale'
import fragmentShader from '../shaders/pressure.frag?raw'
import vertexShader from '../shaders/pressure.vert?raw'
import { resolveIncludes } from '../shaders/include'

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
  // Row 0 is the upper surface, row 1 the lower, which is exactly how the dataset lays the 128
  // columns out, so the upload is a straight copy.
  const texture = new DataTexture(data, CP_STATIONS_PER_SURFACE, 2, RedFormat, FloatType)
  /**
   * Linear sampling, which is the whole point of the chordwise coordinate being continuous.
   *
   * It used to be nearest, with a comment claiming that interpolating would blur the values being
   * read. That had it backwards: the shader inverts the cosine clustering to a *fractional*
   * station, so nearest sampling quantises a smooth field to 64 steps per surface and the section
   * renders as a flight of stairs. Linear interpolation between the two neighbouring stations is
   * the correct reconstruction of a sampled continuous function, not a blur of it.
   */
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
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
