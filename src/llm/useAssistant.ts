import { useCallback, useMemo, useRef, useState } from 'react'

import type { Surrogate } from '../ml/index'
import { INPUT_SIZE, toInput } from '../ml/types'
import { useAppStore } from '../state/store'
import { createAnthropicProvider } from './anthropic'
import { runTurn } from './conversation'
import { createDemoProvider } from './demo'
import type { DesignState, ToolContext, ToolOutcome } from './dispatch'
import { createOpenAiProvider } from './openai'
import { loadApiKey, loadConfig, saveApiKey, saveConfig } from './settings'
import { type ChatMessage, ProviderError, type ProviderConfig } from './types'

/**
 * The assistant, wired to the store and the surrogate.
 *
 * The tool context is the only bridge between a language model and this application's state, and
 * it is three functions wide: read the design, write the design, predict a batch. Everything the
 * assistant can do, it does through those -- which is why the dispatcher can be tested without a
 * browser and why nothing the model says can reach the scene except as a design the sliders could
 * also have produced.
 */

export interface TranscriptEntry {
  readonly id: string
  readonly role: 'user' | 'assistant' | 'tool' | 'error'
  readonly text: string
  readonly outcome?: ToolOutcome
}

export interface AssistantState {
  readonly transcript: readonly TranscriptEntry[]
  readonly busy: boolean
  readonly config: ProviderConfig
  readonly hasKey: boolean
  send: (prompt: string) => Promise<void>
  undo: (entryId: string) => void
  clear: () => void
  setConfig: (config: ProviderConfig) => void
  setKey: (key: string) => void
}

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${String(counter)}`
}

export function useAssistant(surrogate: Surrogate | null): AssistantState {
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [config, setConfigState] = useState<ProviderConfig>(() => loadConfig())
  const [hasKey, setHasKey] = useState(() => loadApiKey() !== '')
  const messages = useRef<readonly ChatMessage[]>([])

  /**
   * The store is read through `getState` rather than a subscription on purpose.
   *
   * A tool runs between two awaits, long after the render that created it, and it needs what the
   * design is *now* -- including a change an earlier tool in the same turn just made. A value
   * captured at render time would be stale by the second tool call.
   */
  const context = useMemo<ToolContext>(
    () => ({
      current: (): DesignState => {
        const state = useAppStore.getState()
        return { section: state.section, alphaDeg: state.alphaDeg, presetId: state.presetId }
      },
      apply: (next) => {
        const state = useAppStore.getState()
        if (next.presetId !== null) state.loadPreset(next.presetId)
        else state.setSection(next.section)
        state.setAlpha(next.alphaDeg)
      },
      predict: async (designs) => {
        if (!surrogate) return []
        const inputs = new Float32Array(designs.length * INPUT_SIZE)
        designs.forEach((design, row) => {
          inputs.set(
            toInput(design.section.upper, design.section.lower, design.alphaDeg),
            row * INPUT_SIZE,
          )
        })
        return surrogate.predictBatch(inputs, designs.length)
      },
    }),
    [surrogate],
  )

  const provider = useMemo(() => {
    const key = loadApiKey()
    if (config.kind === 'anthropic' && key !== '') return createAnthropicProvider(key, config.model)
    if (config.kind === 'openai') return createOpenAiProvider(key, config.model, config.baseUrl)
    return createDemoProvider()
    // `hasKey` is in the dependency list in place of the key itself, which is deliberately never
    // held in state: changing the key has to rebuild the provider, without the key being here.
  }, [config, hasKey])

  const send = useCallback(
    async (prompt: string) => {
      const text = prompt.trim()
      if (text === '' || busy) return

      setBusy(true)
      setTranscript((entries) => [...entries, { id: nextId('user'), role: 'user', text }])

      const history: ChatMessage[] = [...messages.current, { role: 'user', content: text }]
      try {
        const result = await runTurn(provider, context, history, (event) => {
          setTranscript((entries) => [
            ...entries,
            {
              id: nextId(event.kind),
              role: event.kind,
              text: event.text,
              ...(event.outcome ? { outcome: event.outcome } : {}),
            },
          ])
        })
        messages.current = result.messages
      } catch (error) {
        // Never the request, never a header: only what the provider said and the status it said it
        // with. A thrown fetch error can carry a URL, so an unknown error is reported generically.
        const message =
          error instanceof ProviderError
            ? `${config.kind} returned ${String(error.status)}: ${error.message}`
            : 'The request did not reach the provider. Check the network and the base URL.'
        setTranscript((entries) => [
          ...entries,
          { id: nextId('error'), role: 'error', text: message },
        ])
      } finally {
        setBusy(false)
      }
    },
    [busy, config.kind, context, provider],
  )

  const undo = useCallback(
    (entryId: string) => {
      const entry = transcript.find((candidate) => candidate.id === entryId)
      const before = entry?.outcome?.change?.before
      if (before) context.apply(before)
    },
    [context, transcript],
  )

  const clear = useCallback(() => {
    messages.current = []
    setTranscript([])
  }, [])

  const setConfig = useCallback((next: ProviderConfig) => {
    saveConfig(next)
    setConfigState(next)
  }, [])

  const setKey = useCallback((key: string) => {
    saveApiKey(key)
    setHasKey(key.trim() !== '')
  }, [])

  return { transcript, busy, config, hasKey, send, undo, clear, setConfig, setKey }
}
