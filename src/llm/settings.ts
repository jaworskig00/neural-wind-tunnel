import { ANTHROPIC_DEFAULT_MODEL } from './anthropic'
import { OPENAI_DEFAULT_BASE_URL, OPENAI_DEFAULT_MODEL } from './openai'
import type { ProviderConfig, ProviderKind } from './types'

/**
 * Where the assistant's settings live.
 *
 * The key is kept in `localStorage` under a key of its own, apart from everything else, so it can
 * be cleared on its own and so no other setting is ever serialised next to it. It is never written
 * to the URL, never logged, never sent anywhere but the provider the visitor chose. The rest of
 * the app state round-trips through the hash; this deliberately does not.
 */

const KEY_STORAGE = 'nwt.assistant.key'
const CONFIG_STORAGE = 'nwt.assistant.config'

export const DEFAULT_CONFIG: ProviderConfig = {
  kind: 'demo',
  model: ANTHROPIC_DEFAULT_MODEL,
  baseUrl: OPENAI_DEFAULT_BASE_URL,
}

export function defaultModelFor(kind: ProviderKind): string {
  return kind === 'openai' ? OPENAI_DEFAULT_MODEL : ANTHROPIC_DEFAULT_MODEL
}

function safeRead(name: string): string | null {
  try {
    return localStorage.getItem(name)
  } catch {
    // Storage can be denied outright in a locked-down browser. The assistant then works for the
    // session and forgets afterwards, which is a smaller failure than refusing to load.
    return null
  }
}

function safeWrite(name: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(name)
    else localStorage.setItem(name, value)
  } catch {
    // As above.
  }
}

export function loadApiKey(): string {
  return safeRead(KEY_STORAGE) ?? ''
}

export function saveApiKey(key: string): void {
  safeWrite(KEY_STORAGE, key.trim() === '' ? null : key.trim())
}

export function loadConfig(): ProviderConfig {
  const raw = safeRead(CONFIG_STORAGE)
  if (raw === null) return DEFAULT_CONFIG
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CONFIG
    const record = parsed as Record<string, unknown>
    const kind = record['kind']
    return {
      kind: kind === 'anthropic' || kind === 'openai' ? kind : 'demo',
      model: typeof record['model'] === 'string' ? record['model'] : DEFAULT_CONFIG.model,
      baseUrl: typeof record['baseUrl'] === 'string' ? record['baseUrl'] : DEFAULT_CONFIG.baseUrl,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: ProviderConfig): void {
  safeWrite(CONFIG_STORAGE, JSON.stringify(config))
}
