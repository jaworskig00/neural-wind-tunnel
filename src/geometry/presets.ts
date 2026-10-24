/**
 * Preset sections, as CST weights.
 *
 * These are least-squares CST fits of the NACA four-digit sections, computed once by
 * `tools/solver/make_ts_fixtures.py` so the browser never needs the NACA formulae. A six-weight
 * fit cannot reproduce a NACA nose exactly; the residual is below 1e-3 outside the first 0.5 % of
 * chord and is documented in ADR-013.
 */

import type { Section } from './shapeOps'

export interface Preset extends Section {
  readonly id: string
  readonly label: string
  readonly description: string
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'naca0008',
    label: 'NACA 0008',
    description: 'Thin and symmetric: low drag, no lift at zero incidence.',
    upper: [0.114435158, 0.102403622, 0.107821865, 0.090292666, 0.097388329, 0.09566057],
    lower: [-0.114435158, -0.102403622, -0.107821865, -0.090292666, -0.097388329, -0.09566057],
  },
  {
    id: 'naca0012',
    label: 'NACA 0012',
    description: 'The reference symmetric section, 12 per cent thick.',
    upper: [0.171652738, 0.153605433, 0.161732798, 0.135438998, 0.146082494, 0.143490855],
    lower: [-0.171652738, -0.153605433, -0.161732798, -0.135438998, -0.146082494, -0.143490855],
  },
  {
    id: 'naca2412',
    label: 'NACA 2412',
    description: 'Mildly cambered: lift at zero incidence, a nose-down moment.',
    upper: [0.194009556, 0.198091693, 0.232275718, 0.173548002, 0.220891886, 0.207565732],
    lower: [-0.151704614, -0.107001657, -0.093567354, -0.094971159, -0.072929513, -0.079522914],
  },
  {
    id: 'naca4412',
    label: 'NACA 4412',
    description: 'Strongly cambered: more lift, more drag, more moment.',
    upper: [0.218283927, 0.24153741, 0.303555256, 0.210934126, 0.296310271, 0.27214549],
    lower: [-0.134239239, -0.058218393, -0.027868272, -0.052035758, -0.001521896, -0.015621731],
  },
]

export const DEFAULT_PRESET_ID = 'naca2412'

export function presetById(id: string): Preset {
  const preset = PRESETS.find((candidate) => candidate.id === id)
  if (!preset) {
    throw new RangeError(`Unknown preset: ${id}`)
  }
  return preset
}
