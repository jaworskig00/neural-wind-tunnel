import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig } from 'vite'

/**
 * The production Content Security Policy.
 *
 * Injected into the built page rather than written into `index.html`, because the dev server needs
 * `eval` for hot module replacement and a policy that permits that in production would not be
 * worth having.
 *
 * `connect-src` is the interesting line. The assistant is bring-your-own-endpoint: it talks to
 * Anthropic, to OpenAI, or to whatever chat-completions URL the visitor types, including a model
 * running on their own machine. There is no list of origins to allow because the visitor chooses
 * it, so the policy allows outbound HTTPS and loopback, and nothing else. That is weaker than an
 * allowlist and stronger than no policy; the trade is recorded in ADR-023.
 *
 * `wasm-unsafe-eval` is required by onnxruntime-web: instantiating a WebAssembly module counts as
 * eval under CSP. It does not permit JavaScript `eval`.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  // No `frame-ancestors`: a browser ignores it when it arrives in a meta element, and says so in
  // the console on every load. It only works as an HTTP header, which a static host like GitHub
  // Pages cannot send. Clickjacking protection therefore waits for a host that can set headers;
  // there is nothing here to click-jack but a slider, and a policy line that does nothing while
  // printing an error is worse than its absence.
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'neural-wind-tunnel:csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  /**
   * GitHub Pages serves this project under `/neural-wind-tunnel/`, not at a domain root.
   *
   * Only the Pages build sets `PAGES_BASE`; local development, the Playwright suite and CI all
   * stay at `/`, so nothing about the everyday loop changes. Every artifact the app fetches at
   * runtime already resolves through `import.meta.env.BASE_URL` (`src/ml/sources.ts`), so this
   * single value is enough -- there are no absolute `/models/...` paths to find and fix.
   */
  base: process.env['PAGES_BASE'] ?? '/',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  build: {
    // Vite's warning counts uncompressed bytes, which says little about what a visitor downloads.
    // The real budgets are enforced by size-limit against gzip sizes; see `size-limit` in
    // package.json. This threshold only silences a warning the renderer chunk will always trip.
    chunkSizeWarningLimit: 1000,
  },
})
