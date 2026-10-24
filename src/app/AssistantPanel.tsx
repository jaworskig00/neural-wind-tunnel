import { useEffect, useRef, useState } from 'react'

import { DEMO_SCENARIOS } from '../llm/demo'
import { defaultModelFor } from '../llm/settings'
import type { AssistantState } from '../llm/useAssistant'
import type { ProviderKind } from '../llm/types'

/**
 * The assistant, as a drawer over the viewport.
 *
 * Two things this panel does that a chat window usually does not. It shows every tool call the
 * model made, by name and with the one-line summary the dispatcher wrote -- so what the assistant
 * did to the design is visible even when its prose is vague. And each change carries an undo that
 * restores the exact design from before that call, because an assistant that can move twelve
 * sliders at once needs a way back.
 */

const PROVIDERS: readonly { kind: ProviderKind; label: string; note: string }[] = [
  { kind: 'demo', label: 'Demo', note: 'Three recorded conversations. The tools really run.' },
  { kind: 'anthropic', label: 'Anthropic', note: 'Your key, sent from this page to Anthropic.' },
  {
    kind: 'openai',
    label: 'OpenAI-compatible',
    note: 'Any chat-completions endpoint: OpenAI, xAI, a local gateway.',
  },
]

function Entry({
  entry,
  onUndo,
}: {
  readonly entry: AssistantState['transcript'][number]
  readonly onUndo: (id: string) => void
}) {
  if (entry.role === 'user') {
    return (
      <p className="self-end rounded border border-line bg-raised px-2.5 py-1.5 text-xs text-text">
        {entry.text}
      </p>
    )
  }

  if (entry.role === 'tool') {
    return (
      <div className="flex items-baseline gap-2 text-[0.7rem] text-faint" data-testid="tool-call">
        <code className="tabular shrink-0 text-accent">{entry.outcome?.name}</code>
        <span className="flex-1">{entry.text}</span>
        {entry.outcome?.change && (
          <button
            type="button"
            className="shrink-0 underline decoration-dotted underline-offset-2 hover:text-text"
            onClick={() => {
              onUndo(entry.id)
            }}
          >
            undo
          </button>
        )}
      </div>
    )
  }

  if (entry.role === 'error') {
    return (
      <p className="rounded border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
        {entry.text}
      </p>
    )
  }

  return <p className="px-0.5 text-xs leading-relaxed text-text">{entry.text}</p>
}

export interface AssistantPanelProps {
  readonly assistant: AssistantState
  readonly onClose: () => void
}

export function AssistantPanel({ assistant, onClose }: AssistantPanelProps) {
  const [draft, setDraft] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const bottom = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [assistant.transcript])

  const { config } = assistant
  const needsKey = config.kind === 'anthropic' && !assistant.hasKey

  return (
    <section
      className="flex h-full w-96 shrink-0 flex-col border-l border-line bg-surface"
      aria-label="Assistant"
      data-testid="assistant-panel"
    >
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="text-[0.7rem] font-semibold tracking-[0.08em] text-muted uppercase">
          Assistant
        </h2>
        <div className="flex items-center gap-2 text-[0.65rem]">
          <button
            type="button"
            className="text-faint hover:text-text"
            onClick={() => {
              setShowSettings((open) => !open)
            }}
            aria-expanded={showSettings}
          >
            {PROVIDERS.find((entry) => entry.kind === config.kind)?.label ?? config.kind}
          </button>
          <button type="button" className="text-faint hover:text-text" onClick={assistant.clear}>
            clear
          </button>
          <button
            type="button"
            className="text-faint hover:text-text"
            onClick={onClose}
            aria-label="Close the assistant"
          >
            ✕
          </button>
        </div>
      </header>

      {showSettings && (
        <div
          className="space-y-2 border-b border-line px-3 py-2.5"
          data-testid="assistant-settings"
        >
          <div className="grid grid-cols-3 gap-1 text-[0.65rem]">
            {PROVIDERS.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                onClick={() => {
                  assistant.setConfig({
                    ...config,
                    kind: entry.kind,
                    model: defaultModelFor(entry.kind),
                  })
                }}
                className={`rounded border py-1 transition-colors ${
                  config.kind === entry.kind
                    ? 'border-accent bg-raised text-accent'
                    : 'border-line bg-base text-muted hover:border-faint hover:text-text'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className="text-[0.65rem] text-faint">
            {PROVIDERS.find((entry) => entry.kind === config.kind)?.note}
          </p>

          {config.kind !== 'demo' && (
            <>
              <label className="flex items-center gap-2 text-[0.65rem] text-muted">
                <span className="w-12 shrink-0">Model</span>
                <input
                  type="text"
                  value={config.model}
                  onChange={(event) => {
                    assistant.setConfig({ ...config, model: event.target.value })
                  }}
                  className="min-w-0 flex-1 rounded border border-line bg-base px-1.5 py-1 text-text"
                />
              </label>

              {config.kind === 'openai' && (
                <label className="flex items-center gap-2 text-[0.65rem] text-muted">
                  <span className="w-12 shrink-0">URL</span>
                  <input
                    type="text"
                    value={config.baseUrl}
                    onChange={(event) => {
                      assistant.setConfig({ ...config, baseUrl: event.target.value })
                    }}
                    className="min-w-0 flex-1 rounded border border-line bg-base px-1.5 py-1 text-text"
                  />
                </label>
              )}

              <label className="flex items-center gap-2 text-[0.65rem] text-muted">
                <span className="w-12 shrink-0">Key</span>
                <input
                  type="password"
                  value={keyDraft}
                  placeholder={assistant.hasKey ? 'stored in this browser' : 'paste a key'}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setKeyDraft(event.target.value)
                  }}
                  onBlur={() => {
                    if (keyDraft !== '') {
                      assistant.setKey(keyDraft)
                      setKeyDraft('')
                    }
                  }}
                  className="min-w-0 flex-1 rounded border border-line bg-base px-1.5 py-1 text-text"
                />
                {assistant.hasKey && (
                  <button
                    type="button"
                    className="shrink-0 text-faint underline decoration-dotted hover:text-text"
                    onClick={() => {
                      assistant.setKey('')
                    }}
                  >
                    forget
                  </button>
                )}
              </label>

              <p className="text-[0.65rem] text-faint">
                The key is kept in this browser&rsquo;s local storage and sent straight to the
                provider you chose. It is never put in a URL, a log or this project&rsquo;s own
                servers — there are none.
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        {assistant.transcript.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-faint">
              Ask for a change and it will make it, then read the result back out of the surrogate.
              Every number it quotes comes from a tool call you can see.
            </p>
            <div className="flex flex-col gap-1">
              {DEMO_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  className="rounded border border-line bg-base px-2 py-1.5 text-left text-[0.7rem] text-muted hover:border-faint hover:text-text"
                  onClick={() => {
                    void assistant.send(scenario.prompt)
                  }}
                >
                  {scenario.prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {assistant.transcript.map((entry) => (
          <Entry key={entry.id} entry={entry} onUndo={assistant.undo} />
        ))}
        {assistant.busy && <p className="text-[0.7rem] text-faint">thinking…</p>}
        <div ref={bottom} />
      </div>

      <form
        className="flex items-center gap-2 border-t border-line px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault()
          const text = draft
          setDraft('')
          void assistant.send(text)
        }}
      >
        <input
          type="text"
          value={draft}
          placeholder={needsKey ? 'Add a key, or switch to the demo' : 'Make it thinner…'}
          aria-label="Message the assistant"
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          className="min-w-0 flex-1 rounded border border-line bg-base px-2 py-1.5 text-xs text-text"
        />
        <button
          type="submit"
          disabled={assistant.busy || draft.trim() === ''}
          className="rounded border border-line bg-base px-2.5 py-1.5 text-xs text-muted hover:border-faint hover:text-text disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </section>
  )
}
