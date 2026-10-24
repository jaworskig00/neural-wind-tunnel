/**
 * The trail buffer.
 *
 * Particles are not drawn to the screen. They are drawn into an accumulation target that is faded
 * rather than cleared, and that target is composited over the scene. The difference is the whole
 * visual argument: a snapshot of a million uniformly distributed dots reads as static however fast
 * they are moving, because what the eye reads as flow is the path each one has taken.
 *
 * Three stages per frame, all at the canvas resolution:
 *   * fade the history into the back target;
 *   * draw the particles into it additively;
 *   * composite it over the scene.
 */

import {
  AdditiveBlending,
  type Camera,
  type Object3D,
  Scene,
  Vector2,
  type WebGLRenderer,
} from 'three'

import type { Precision } from '../rom/capabilities'
import compositeShader from '../shaders/trailComposite.frag?raw'
import fadeShader from '../shaders/trailFade.frag?raw'
import { FullscreenPass } from './fullscreenPass'
import { PingPong } from './pingPong'

export interface TrailOptions {
  readonly width: number
  readonly height: number
  readonly precision: Precision
  /** Per-second decay rate. Higher fades faster; around 2 gives a trail of roughly half a second. */
  readonly decay?: number
  readonly intensity?: number
}

export class TrailBuffer {
  private targets: PingPong
  private readonly fade: FullscreenPass
  private readonly composite: FullscreenPass
  private readonly particleScene = new Scene()
  private width: number
  private height: number

  constructor({ width, height, precision, decay = 2.6, intensity = 0.5 }: TrailOptions) {
    this.width = width
    this.height = height
    this.targets = new PingPong({ width, height, precision, linear: true })

    this.fade = new FullscreenPass({
      fragmentShader: fadeShader,
      uniforms: {
        uPrevious: { value: null },
        uDecay: { value: decay },
        uDeltaTime: { value: 0 },
      },
    })

    this.composite = new FullscreenPass({
      fragmentShader: compositeShader,
      uniforms: {
        uTrails: { value: null },
        uIntensity: { value: intensity },
      },
      blending: AdditiveBlending,
      transparent: true,
    })
  }

  /** The particle object is held here rather than in the main scene, so it can be drawn off-screen. */
  setParticles(object: Object3D): void {
    this.particleScene.clear()
    this.particleScene.add(object)
  }

  resize(width: number, height: number, precision: Precision): void {
    if (width === this.width && height === this.height) return
    this.targets.dispose()
    this.targets = new PingPong({ width, height, precision, linear: true })
    this.width = width
    this.height = height
  }

  /** Fades the history and draws the particles into it. */
  accumulate(renderer: WebGLRenderer, camera: Camera, deltaTime: number): void {
    // The composite still holds last frame's texture, which after the swap is the target about to
    // be written. Leaving it bound makes the driver report a feedback loop and drop the draw
    // entirely -- a black frame with only a warning to go on. Unbinding first is the whole fix.
    this.composite.uniforms['uTrails']!.value = null

    this.fade.uniforms['uPrevious']!.value = this.targets.read.texture
    this.fade.uniforms['uDeltaTime']!.value = Math.min(deltaTime, 1 / 30)
    this.fade.render(renderer, this.targets.write)

    const previousTarget = renderer.getRenderTarget()
    const previousAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(this.targets.write)
    renderer.render(this.particleScene, camera)
    renderer.setRenderTarget(previousTarget)
    renderer.autoClear = previousAutoClear

    this.targets.swap()
  }

  /** Draws the accumulated trails over whatever is already on screen. */
  draw(renderer: WebGLRenderer): void {
    this.composite.uniforms['uTrails']!.value = this.targets.read.texture
    const previousAutoClear = renderer.autoClear
    renderer.autoClear = false
    this.composite.render(renderer, null)
    renderer.autoClear = previousAutoClear
  }

  setIntensity(intensity: number): void {
    this.composite.uniforms['uIntensity']!.value = intensity
  }

  get size(): Vector2 {
    return new Vector2(this.width, this.height)
  }

  dispose(): void {
    this.fade.dispose()
    this.composite.dispose()
    this.targets.dispose()
  }
}
