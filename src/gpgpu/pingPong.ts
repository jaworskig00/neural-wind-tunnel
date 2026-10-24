/**
 * A pair of render targets a simulation reads from and writes to alternately.
 *
 * A fragment shader cannot read the texture it is writing, so a simulation that advances state in
 * place needs two targets and a swap each step. That is the whole of the GPGPU trick, and keeping
 * it in one small class is what stops the swap being open-coded -- and eventually mis-coded -- in
 * every simulation that needs it.
 */

import {
  ClampToEdgeWrapping,
  FloatType,
  HalfFloatType,
  NearestFilter,
  RGBAFormat,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'

import type { Precision } from '../rom/capabilities'

export interface PingPongOptions {
  readonly width: number
  readonly height: number
  readonly precision: Precision
  /** Linear filtering, for a field that is sampled at arbitrary positions rather than per texel. */
  readonly linear?: boolean
}

function createTarget({ width, height, precision, linear }: PingPongOptions): WebGLRenderTarget {
  const filter = linear ? undefined : NearestFilter
  return new WebGLRenderTarget(width, height, {
    format: RGBAFormat,
    type: precision === 'float' ? FloatType : HalfFloatType,
    ...(filter ? { minFilter: filter, magFilter: filter } : {}),
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  })
}

export class PingPong {
  private targets: [WebGLRenderTarget, WebGLRenderTarget]
  private current = 0

  constructor(options: PingPongOptions) {
    this.targets = [createTarget(options), createTarget(options)]
  }

  /** The target holding the current state, to be read. */
  get read(): WebGLRenderTarget {
    return this.targets[this.current]!
  }

  /** The target the next step writes into. */
  get write(): WebGLRenderTarget {
    return this.targets[1 - this.current]!
  }

  swap(): void {
    this.current = 1 - this.current
  }

  /** Clears both targets, so a simulation never starts from whatever was in GPU memory. */
  clear(renderer: WebGLRenderer): void {
    const previous = renderer.getRenderTarget()
    for (const target of this.targets) {
      renderer.setRenderTarget(target)
      renderer.clear(true, false, false)
    }
    renderer.setRenderTarget(previous)
  }

  dispose(): void {
    for (const target of this.targets) {
      target.dispose()
    }
  }
}
