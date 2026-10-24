/**
 * The particle field.
 *
 * A million particles whose positions live in a texture and never touch the CPU. Each frame one
 * full-screen pass advances every position by a Runge-Kutta step through the reconstructed velocity
 * field, and one draw call renders them as points, reading their positions back out of that same
 * texture in the vertex shader.
 *
 * The particle count is the texture area: a 1024 by 1024 position texture is 1 048 576 particles,
 * and dropping a tier is a smaller texture, nothing more.
 *
 * Trails are an accumulation target that is faded rather than cleared, so a particle leaves a decaying
 * streak behind it. That costs one extra pass and is most of what makes the field read as flow
 * rather than as confetti.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
  type Texture,
  type WebGLRenderer,
} from 'three'

import type { Precision, Tier } from '../rom/capabilities'
import { DOMAIN_MAX, DOMAIN_MIN } from '../rom/reconstruction'
import fragmentShader from '../shaders/particleRender.frag?raw'
import updateShader from '../shaders/particleUpdate.frag?raw'
import vertexShader from '../shaders/particleRender.vert?raw'
import { resolveIncludes } from '../shaders/include'
import { FullscreenPass } from './fullscreenPass'
import { PingPong } from './pingPong'

export interface ParticleOptions {
  readonly tier: Tier
  readonly precision: Precision
  /** Chord lengths travelled per second at freestream speed. */
  readonly speed?: number
  /** Seconds before a particle is recycled, so the distribution never collapses into the wake. */
  readonly maxAge?: number
}

const DEFAULT_SPEED = 0.6
const DEFAULT_MAX_AGE = 6

/**
 * Per-particle opacity is scaled against this count.
 *
 * Total brightness is particle count times per-particle opacity, so a fixed opacity makes the
 * picture four times brighter on the high tier than on the mid one -- and a value tuned on one tier
 * saturates to white on another. Scaling inversely keeps the integrated exposure the same, which
 * also means the tiers can be compared for what they actually differ in: how finely the flow is
 * resolved, not how bright it is.
 */
const REFERENCE_PARTICLE_COUNT = 262_144
const REFERENCE_OPACITY = 0.012

export class ParticleField {
  readonly points: Points

  private readonly positions: PingPong
  private readonly update: FullscreenPass
  private readonly renderMaterial: ShaderMaterial
  private readonly geometry: BufferGeometry
  private readonly textureSize: number
  private elapsed = 0

  constructor({
    tier,
    precision,
    speed = DEFAULT_SPEED,
    maxAge = DEFAULT_MAX_AGE,
  }: ParticleOptions) {
    this.textureSize = tier.texture
    this.positions = new PingPong({
      width: tier.texture,
      height: tier.texture,
      precision,
    })

    this.update = new FullscreenPass({
      fragmentShader: updateShader,
      uniforms: {
        uPositions: { value: null },
        uVelocity: { value: null },
        uBodyMask: { value: null },
        uDeltaTime: { value: 0 },
        uTime: { value: 0 },
        uSpeed: { value: speed },
        uMaxAge: { value: maxAge },
        uSeeding: { value: false },
        uDomainMin: { value: DOMAIN_MIN.clone() },
        uDomainMax: { value: DOMAIN_MAX.clone() },
      },
    })

    // One vertex per particle, carrying only the texel to read its position from.
    const count = tier.texture * tier.texture
    const indices = new Float32Array(count * 2)
    for (let i = 0; i < count; i += 1) {
      indices[i * 2] = ((i % tier.texture) + 0.5) / tier.texture
      indices[i * 2 + 1] = (Math.floor(i / tier.texture) + 0.5) / tier.texture
    }
    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('aIndex', new BufferAttribute(indices, 2))
    // A position attribute is required by three even though the vertex shader ignores it.
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
    this.geometry.boundingSphere = null

    this.renderMaterial = new ShaderMaterial({
      vertexShader: resolveIncludes(vertexShader),
      fragmentShader: resolveIncludes(fragmentShader),
      uniforms: {
        uPositions: { value: null },
        uVelocity: { value: null },
        uPointSize: { value: 38 },
        uMaxAge: { value: maxAge },
        uSpeedMin: { value: 0.0 },
        uSpeedMax: { value: 1.8 },
        // Low, because the trail buffer integrates every frame a particle is drawn: a value
        // that looks right for a single frame saturates to white within half a second.
        uOpacity: { value: (REFERENCE_OPACITY * REFERENCE_PARTICLE_COUNT) / count },
        uColormap: { value: 0 },
        uDomainMin: { value: DOMAIN_MIN.clone() },
        uDomainMax: { value: DOMAIN_MAX.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })

    this.points = new Points(this.geometry, this.renderMaterial)
    this.points.frustumCulled = false
  }

  get particleCount(): number {
    return this.textureSize * this.textureSize
  }

  /** The target holding current positions, for reading back during diagnosis. */
  get debugTarget() {
    return this.positions.read
  }

  /**
   * Seeds every particle, so the simulation starts from a known state.
   *
   * An explicit pass rather than a clear: a cleared target holds whatever colour the renderer was
   * last set to, which is not something a simulation should depend on. Both targets are written so
   * that whichever one the first step reads is already populated.
   */
  reset(renderer: WebGLRenderer): void {
    this.update.uniforms['uSeeding']!.value = true
    this.renderMaterial.uniforms['uPositions']!.value = null

    // Both targets are seeded so whichever one the first step reads is already populated. The
    // uniform is re-pointed before each pass rather than once: after the swap the texture it held
    // is the target about to be written, and that is a feedback loop the driver refuses to draw.
    for (let pass = 0; pass < 2; pass += 1) {
      this.update.uniforms['uPositions']!.value = this.positions.read.texture
      this.update.render(renderer, this.positions.write)
      this.positions.swap()
    }

    this.update.uniforms['uPositions']!.value = null
    this.update.uniforms['uSeeding']!.value = false
    this.elapsed = 0
  }

  /** Advances every particle by one step. */
  step(renderer: WebGLRenderer, deltaTime: number, velocity: Texture, bodyMask: Texture): void {
    // A long frame -- a tab regaining focus, a shader compile -- must not teleport the field.
    const clamped = Math.min(deltaTime, 1 / 30)
    this.elapsed += clamped

    // Same reason as the trail buffer: the render material holds the texture that is about to
    // become the write target, and a bound-for-reading render target is a feedback loop.
    this.renderMaterial.uniforms['uPositions']!.value = null

    this.update.uniforms['uPositions']!.value = this.positions.read.texture
    this.update.uniforms['uVelocity']!.value = velocity
    this.update.uniforms['uBodyMask']!.value = bodyMask
    this.update.uniforms['uDeltaTime']!.value = clamped
    this.update.uniforms['uTime']!.value = this.elapsed
    this.update.render(renderer, this.positions.write)
    this.positions.swap()

    this.renderMaterial.uniforms['uPositions']!.value = this.positions.read.texture
    this.renderMaterial.uniforms['uVelocity']!.value = velocity
  }

  setColormap(index: number): void {
    this.renderMaterial.uniforms['uColormap']!.value = index
  }

  setOpacity(opacity: number): void {
    this.renderMaterial.uniforms['uOpacity']!.value = opacity
  }

  dispose(): void {
    this.update.dispose()
    this.positions.dispose()
    this.geometry.dispose()
    this.renderMaterial.dispose()
  }
}
