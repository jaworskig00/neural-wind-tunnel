import { type ToolContext, type ToolOutcome, runTool } from './dispatch'
import { SYSTEM_PROMPT, TOOLS } from './tools'
import type { ChatMessage, Provider } from './types'

/**
 * One turn: ask, run whatever tools come back, ask again, until the model stops.
 *
 * The loop is bounded. A model that keeps calling tools is either confused or looping, and either
 * way the visitor should get an answer rather than an unbounded bill, so after `MAX_STEPS` the
 * conversation is closed with what it has.
 */

export const MAX_STEPS = 6

export interface TurnEvent {
  readonly kind: 'assistant' | 'tool'
  readonly text: string
  readonly outcome?: ToolOutcome
}

export interface TurnResult {
  readonly messages: readonly ChatMessage[]
  readonly events: readonly TurnEvent[]
}

export async function runTurn(
  provider: Provider,
  context: ToolContext,
  history: readonly ChatMessage[],
  onEvent?: (event: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const messages: ChatMessage[] = [...history]
  const events: TurnEvent[] = []

  const emit = (event: TurnEvent) => {
    events.push(event)
    onEvent?.(event)
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const reply = await provider.send({
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      ...(signal ? { signal } : {}),
    })

    messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls })
    if (reply.content.trim() !== '') emit({ kind: 'assistant', text: reply.content })

    if (reply.stop !== 'tool_use' || reply.toolCalls.length === 0) return { messages, events }

    for (const toolCall of reply.toolCalls) {
      const outcome = await runTool(toolCall.name, { ...toolCall.input }, context)
      messages.push({
        role: 'tool',
        callId: toolCall.id,
        name: toolCall.name,
        content: JSON.stringify(outcome.result),
      })
      emit({ kind: 'tool', text: outcome.summary, outcome })
    }
  }

  emit({
    kind: 'assistant',
    text: `Stopped after ${String(MAX_STEPS)} steps without a final answer.`,
  })
  return { messages, events }
}
