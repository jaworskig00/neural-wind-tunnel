/**
 * Rebuilds the velocity field from the surrogate's modal coefficients.
 *
 * The step the project is named for. Thirty-two numbers come out of the network; this turns them
 * back into a 192 by 96 velocity field on the GPU, in one pass, without the field ever existing on
 * the CPU. It runs when the prediction changes -- a slider drag, a preset, an assistant edit -- not
 * every frame.
 *
 * The output is in the section frame: body axis-aligned, flow arriving at the angle of attack. The
 * scene rotates the whole group by the negative of that angle, which puts the freestream horizontal
 * on screen without a single rotation inside the simulation.
 */

import { Vector2, type WebGLRenderer } from 'three'

import { FullscreenPass } from '../gpgpu/fullscreenPass'
import { PingPong } from '../gpgpu/pingPong'
import fragmentShader from '../shaders/rom.frag?raw'
import type { Precision } from './capabilities'
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FIELD_X_RANGE,
  FIELD_Y_RANGE,
  MODE_COUNT,
  type PodAtlas,
} from './podAtlas'

export const DOMAIN_MIN = new Vector2(FIELD_X_RANGE[0], FIELD_Y_RANGE[0])
export const DOMAIN_MAX = new Vector2(FIELD_X_RANGE[1], FIELD_Y_RANGE[1])

export class FieldReconstruction {
  private readonly pass: FullscreenPass
  private readonly targets: PingPong
  private readonly coefficients = new Float32Array(MODE_COUNT)

  constructor(atlas: PodAtlas, precision: Precision) {
    this.targets = new PingPong({
      width: FIELD_WIDTH,
      height: FIELD_HEIGHT,
      precision,
      // The field is sampled at arbitrary particle positions, not per texel, so it is filtered.
      linear: true,
    })
    this.pass = new FullscreenPass({
      fragmentShader,
      defines: { MODE_COUNT },
      uniforms: {
        uModes: { value: atlas.texture },
        uCoefficients: { value: this.coefficients },
        uAlphaRadians: { value: 0 },
      },
    })
  }

  /** The most recently reconstructed field. */
  get texture() {
    return this.targets.read.texture
  }

  /** The render target itself, for reading pixels back during diagnosis. */
  get debugTarget() {
    return this.targets.read
  }

  /**
   * Rebuilds the field for one prediction.
   *
   * Writes into the back target and swaps, rather than rendering in place: the particle step may
   * still be reading the front one within the same frame.
   */
  update(renderer: WebGLRenderer, modalCoefficients: Float32Array, alphaDeg: number): void {
    if (modalCoefficients.length !== MODE_COUNT) {
      throw new RangeError(
        `Expected ${MODE_COUNT} modal coefficients, got ${modalCoefficients.length}`,
      )
    }
    this.coefficients.set(modalCoefficients)
    this.pass.uniforms['uAlphaRadians']!.value = (alphaDeg * Math.PI) / 180
    this.pass.render(renderer, this.targets.write)
    this.targets.swap()
  }

  dispose(): void {
    this.pass.dispose()
    this.targets.dispose()
  }
}
