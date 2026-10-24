/**
 * Where the model artifacts come from.
 *
 * They are not committed: a model and its weight blob are generated output, and ADR-012 keeps
 * generated artifacts in GitHub Releases rather than in the repository. `pnpm models:sync` places
 * them under `public/models`, so the app always fetches them from its own origin — no cross-origin
 * request, no dependency on GitHub being reachable at run time, and the production build is a plain
 * static directory.
 *
 * `?backend=typescript` forces the hand-written fallback, which is how the parity test exercises
 * both backends against one build.
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

/** Backend requested by the URL, if any. */
export function requestedBackend(search: string = window.location.search): BackendName {
  return new URLSearchParams(search).get('backend') === 'typescript' ? 'typescript' : 'onnx'
}
