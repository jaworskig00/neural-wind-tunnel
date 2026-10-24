/**
 * A shader run over every texel of a render target.
 *
 * Every GPU stage in this project that is not drawing geometry is one of these: rebuilding the
 * velocity field from modal coefficients, stepping the particles, fading the trails. They all want
 * the same thing -- a quad covering the target, no camera, one fragment shader -- so they share one
 * implementation rather than each carrying its own scene.
 *
 * The quad is a single oversized triangle rather than two triangles. It costs one vertex less and,
 * more usefully, avoids the diagonal seam where two triangles meet, along which some drivers
 * interpolate very slightly differently.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  Scene,
  type Blending,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'

import vertexShader from '../shaders/fullscreen.vert?raw'
import { resolveIncludes } from '../shaders/include'

function fullscreenTriangle(): BufferGeometry {
  const geometry = new BufferGeometry()
  // Clip-space coordinates covering the viewport, with uv following them.
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  )
  return geometry
}

export interface FullscreenPassOptions {
  readonly fragmentShader: string
  readonly uniforms: Record<string, { value: unknown }>
  readonly defines?: Record<string, string | number>
  /**
   * Blending, set at construction.
   *
   * Assigning `material.blending` afterwards does not take effect without `needsUpdate`, and the
   * symptom is quiet: the pass renders with normal blending and replaces the frame instead of
   * adding to it. Passing it here removes the trap.
   */
  readonly blending?: Blending
  readonly transparent?: boolean
}

export class FullscreenPass {
  readonly material: ShaderMaterial

  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly geometry = fullscreenTriangle()
  private readonly mesh: Mesh

  constructor({
    fragmentShader,
    uniforms,
    defines,
    blending = NormalBlending,
    transparent = false,
  }: FullscreenPassOptions) {
    this.material = new ShaderMaterial({
      vertexShader: resolveIncludes(vertexShader),
      fragmentShader: resolveIncludes(fragmentShader),
      // Every pass derives its texel coordinate from `gl_FragCoord` and this, so no pass has to
      // remember to declare it and none can be caught out by a missing attribute.
      uniforms: { uResolution: { value: new Vector2() }, ...uniforms },
      ...(defines ? { defines } : {}),
      depthTest: false,
      depthWrite: false,
      blending,
      transparent,
    })
    this.mesh = new Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  get uniforms(): Record<string, { value: unknown }> {
    return this.material.uniforms
  }

  render(renderer: WebGLRenderer, target: WebGLRenderTarget | null): void {
    const previous = renderer.getRenderTarget()
    const resolution = this.material.uniforms['uResolution']!.value as Vector2
    if (target) {
      resolution.set(target.width, target.height)
    } else {
      // The drawing buffer, not the CSS size: `gl_FragCoord` is in device pixels, and on a
      // display with a pixel ratio of two the CSS size halves every coordinate, which draws the
      // pass at double scale and shows a quarter of it, offset.
      renderer.getDrawingBufferSize(resolution)
    }
    renderer.setRenderTarget(target)
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(previous)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
