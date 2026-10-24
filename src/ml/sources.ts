/**
 * Where the model artifacts come from.
 *
 * They are not committed: a model and its weight blob are generated output, and ADR-012 keeps
 * generated artifacts in GitHub Releases rather than in the repository. `pnpm models:sync` places
 * them under `public/models`, so the app always fetches them from its own origin — no cross-origin
 * request, no dependency on GitHub being reachable at run time, and the production build is a plain
 * static directory.
 *
 * `?backend=onnx` opts into ONNX Runtime Web. The hand-written pass is the default; ADR-021 has the
 * measurements behind that.
 */

import type { BackendName, SurrogateSources } from './index'

const MODEL_DIRECTORY = 'models/'

function base(): string {
  const configured = import.meta.env.BASE_URL
  return configured.endsWith('/') ? configured : `${configured}/`
}

export function surrogateSources(): SurrogateSources {
  const root = `${base()}${MODEL_DIRECTORY}`
  return {
    onnx: `${root}surrogate.onnx`,
    weights: `${root}weights.bin`,
    manifest: `${root}manifest.json`,
  }
}

export function podAtlasUrl(): string {
  return `${base()}${MODEL_DIRECTORY}pod_modes.bin`
}

/**
 * Backend requested by the URL, defaulting to the hand-written pass.
 *
 * Measured on the same sixty-step incidence sweep: the TypeScript forward pass runs at 0.9 ms p95
 * against ONNX Runtime Web's 1.9 ms, and costs 6.8 MB less gzipped WebAssembly. ONNX stays the
 * canonical exported artifact and a parity test holds the two to 1e-4 of each other, so this is a
 * delivery choice, not a retreat from the format. See ADR-021.
 */
export function requestedBackend(search: string = window.location.search): BackendName {
  return new URLSearchParams(search).get('backend') === 'onnx' ? 'onnx' : 'typescript'
}
