import { describe, expect, it } from 'vitest'

import particleRender from './particleRender.frag?raw'
import particleUpdate from './particleUpdate.frag?raw'
import fragmentShader from './pressure.frag?raw'
import vertexShader from './pressure.vert?raw'
import { SHADER_CHUNK_NAMES, resolveIncludes } from './include'

describe('resolveIncludes', () => {
  it('knows the project chunks', () => {
    expect(SHADER_CHUNK_NAMES).toEqual(['colormap', 'hash', 'stations'])
  })

  it('substitutes a chunk', () => {
    const resolved = resolveIncludes('#include <stations>\nvoid main() {}')
    expect(resolved).toContain('float stationIndexFromChord')
    expect(resolved).not.toContain('#include')
  })

  it('leaves unrelated source alone', () => {
    const source = 'void main() { gl_FragColor = vec4(1.0); }'
    expect(resolveIncludes(source)).toBe(source)
  })

  it('throws on an unknown chunk rather than silently dropping it', () => {
    expect(() => resolveIncludes('#include <nonexistent>')).toThrow(/Unknown shader chunk/)
  })

  it('resolves every include in every shader that uses one', () => {
    for (const source of [vertexShader, fragmentShader, particleUpdate, particleRender]) {
      const resolved = resolveIncludes(source)
      expect(resolved).not.toMatch(/#include/)
    }
  })

  it('provides hashes that do not rely on a large-magnitude product', () => {
    // The usual `fract(sin(dot(p, k)) * 43758.5453)` loses every low-order bit in float32 once the
    // product reaches 1e7, and neighbouring texels then hash identically. That cost an afternoon
    // and a million particles landing on one point, so it must not come back.
    const resolved = resolveIncludes('#include <hash>')
    expect(resolved).toContain('hash12')
    expect(resolved).toContain('hash22')
    // Comments are stripped first: the chunk explains the failure mode, and that explanation
    // names the very constant being banned.
    const code = resolved.replace(/\/\/.*$/gm, '')
    expect(code).not.toContain('43758')
  })
})

describe('pressure shaders', () => {
  it('declare the uniforms the material supplies', () => {
    const resolved = resolveIncludes(fragmentShader)
    for (const uniform of [
      'uPressure',
      'uPressureMin',
      'uPressureMax',
      'uColormap',
      'uShadingStrength',
    ]) {
      expect(resolved).toContain(uniform)
    }
  })

  it('pass the chordwise station and the surface between stages', () => {
    expect(vertexShader).toContain('varying float vChord')
    expect(vertexShader).toContain('varying float vSurface')
    expect(fragmentShader).toContain('varying float vChord')
    expect(fragmentShader).toContain('varying float vSurface')
  })

  it('read the surface attribute the geometry builder writes', () => {
    expect(vertexShader).toContain('attribute float aSurface')
  })
})
