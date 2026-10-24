import { describe, expect, it } from 'vitest'

import fragmentShader from './pressure.frag?raw'
import vertexShader from './pressure.vert?raw'
import { SHADER_CHUNK_NAMES, resolveIncludes } from './include'

describe('resolveIncludes', () => {
  it('knows the project chunks', () => {
    expect(SHADER_CHUNK_NAMES).toEqual(['colormap', 'stations'])
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

  it('resolves every include in the pressure shaders', () => {
    for (const source of [vertexShader, fragmentShader]) {
      const resolved = resolveIncludes(source)
      expect(resolved).not.toMatch(/#include/)
    }
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
