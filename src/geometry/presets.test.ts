import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { PRESETS } from './presets'

/**
 * The preset list in `docs/URL-STATE.md` has to be the preset list in this module.
 *
 * That document is the deep-link contract the sister project reads, and it drifted: it named a
 * `naca23012` that never existed and omitted `naca0008` that always did. Nothing caught it,
 * because a document cannot fail a build on its own. This test makes it able to.
 */
describe('the published preset contract', () => {
  const contract = readFileSync('docs/URL-STATE.md', 'utf8')
  const row = contract.split('\n').find((line) => line.startsWith('| `p`'))

  it('documents the `p` key at all', () => {
    expect(row).toBeDefined()
  })

  it('names every preset the code has, and no others', () => {
    // A set, because the fallback sentence names `naca2412` a second time.
    const documented = new Set(
      [...(row ?? '').matchAll(/`(naca[0-9]+)`/g)].map((match) => match[1]),
    )
    expect([...documented].sort()).toEqual(PRESETS.map((preset) => preset.id).sort())
  })

  it('names the fallback the reader actually uses', () => {
    // `urlState.ts` falls back to NACA 2412 for an unknown name; the document says so, and this
    // keeps the two sentences in agreement.
    expect(row).toContain('naca2412')
    expect(PRESETS.some((preset) => preset.id === 'naca2412')).toBe(true)
  })
})
