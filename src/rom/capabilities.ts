/**
 * What the GPU in front of us can actually do.
 *
 * Decided once, before the first frame, because the alternative is discovering it as a black screen
 * on someone else's laptop. Every answer here has a working path behind it: the flow field degrades
 * to half precision and fewer particles rather than failing.
 */

export type Precision = 'float' | 'half'

export interface GpuCapabilities {
  readonly webgl2: boolean
  /** Renderable 32-bit float targets. Needed for the velocity field at full precision. */
  readonly colorBufferFloat: boolean
  /** Renderable 16-bit float targets. The fallback, and near-universal. */
  readonly colorBufferHalfFloat: boolean
  /** Linear filtering of float textures. Without it the field is sampled nearest and looks blocky. */
  readonly floatLinear: boolean
  readonly maxTextureSize: number
  readonly precision: Precision
  readonly renderer: string
}

const UNKNOWN: GpuCapabilities = {
  webgl2: false,
  colorBufferFloat: false,
  colorBufferHalfFloat: false,
  floatLinear: false,
  maxTextureSize: 0,
  precision: 'half',
  renderer: 'unavailable',
}

/**
 * Probes a throwaway context rather than the renderer's own.
 *
 * The probe has to run before the scene is built, so it cannot borrow a context that does not exist
 * yet, and a context created for one canvas says the same things as a context created for another.
 */
export function detectCapabilities(): GpuCapabilities {
  if (typeof document === 'undefined') return UNKNOWN

  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) return UNKNOWN

  const colorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null
  const colorBufferHalfFloat =
    colorBufferFloat || gl.getExtension('EXT_color_buffer_half_float') !== null
  const floatLinear = gl.getExtension('OES_texture_float_linear') !== null
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')

  const capabilities: GpuCapabilities = {
    webgl2: true,
    colorBufferFloat,
    colorBufferHalfFloat,
    floatLinear,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    precision: colorBufferFloat ? 'float' : 'half',
    renderer: debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : 'unknown renderer',
  }

  // The probe context is of no further use and holds a real GPU context slot.
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return capabilities
}

/** Particle counts offered, largest first. The probe in `src/gpgpu` picks between them. */
export const PARTICLE_TIERS = [
  { name: 'high', particles: 1_048_576, texture: 1024 },
  { name: 'mid', particles: 262_144, texture: 512 },
  { name: 'low', particles: 65_536, texture: 256 },
] as const

export type TierName = (typeof PARTICLE_TIERS)[number]['name']
export type Tier = (typeof PARTICLE_TIERS)[number]

export function tierByName(name: TierName): Tier {
  const tier = PARTICLE_TIERS.find((candidate) => candidate.name === name)
  if (!tier) throw new RangeError(`Unknown particle tier: ${name}`)
  return tier
}

/**
 * The tier to start from.
 *
 * Deliberately conservative, even on hardware that reports everything. A capability check says what
 * a driver claims to support, not what it will sustain: a software renderer answers yes to all of
 * it and then takes a tenth of a second per frame at a million particles, which is a terrible first
 * impression and, on a slow machine, several seconds before anything appears at all.
 *
 * So the first guess is the middle tier, which holds 30 frames per second with no GPU whatsoever,
 * and the frame-time probe raises it within a second or two on hardware that can take it. Starting
 * low and climbing is invisible; starting high and stuttering is the first thing anyone notices.
 */
export function initialTier(capabilities: GpuCapabilities): Tier {
  if (!capabilities.webgl2 || !capabilities.colorBufferHalfFloat) return tierByName('low')
  return tierByName('mid')
}

/** What the flow field reports about the tier it is actually running. */
export interface TierReport {
  readonly tier: Tier
  /** Median frame time behind the decision, or zero before the probe has measured anything. */
  readonly medianFrameMs: number
  /** False when the viewer chose the tier themselves. */
  readonly automatic: boolean
}
