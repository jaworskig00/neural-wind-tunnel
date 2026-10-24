import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const query = window.matchMedia(QUERY)
  query.addEventListener('change', onChange)
  return () => {
    query.removeEventListener('change', onChange)
  }
}

function snapshot(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(QUERY).matches
}

/**
 * Whether the operating system asks for reduced motion.
 *
 * `useSyncExternalStore` rather than an effect with state: the media query is an external store in
 * the precise sense React means, and reading it this way keeps the first render honest instead of
 * painting the animated view and then taking it away.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
