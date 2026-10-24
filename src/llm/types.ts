/**
 * The shape of a conversation, independent of whose API carries it.
 *
 * Two providers speak here -- Anthropic's Messages API and anything that implements OpenAI's
 * chat-completions shape -- and they disagree about almost every field name. Keeping one internal
 * form and translating at the edge means the chat panel, the transcripts and the tests all work
 * against a single vocabulary, and adding a third provider is one file.
 */

export interface ToolCall {
  /** The provider's own id for the call, which must be echoed back with the result. */
  readonly id: string
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
}

export type ChatMessage =
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant'
      readonly content: string
      readonly toolCalls: readonly ToolCall[]
    }
  | {
      readonly role: 'tool'
      readonly callId: string
      readonly name: string
      /** JSON, as a string: both providers want the result as text. */
      readonly content: string
    }

export interface ToolSchema {
  readonly name: string
  readonly description: string
  /** JSON Schema for the arguments. Draft-07 subset, which both providers accept. */
  readonly parameters: Readonly<Record<string, unknown>>
}

export interface ProviderRequest {
  readonly system: string
  readonly messages: readonly ChatMessage[]
  readonly tools: readonly ToolSchema[]
  readonly signal?: AbortSignal
}

export interface ProviderReply {
  readonly content: string
  readonly toolCalls: readonly ToolCall[]
  /** `tool_use` when the model wants a tool run, `end` when it is finished. */
  readonly stop: 'tool_use' | 'end'
}

export interface ProviderConfig {
  readonly kind: ProviderKind
  readonly model: string
  /** OpenAI-compatible only. Anthropic's endpoint is fixed. */
  readonly baseUrl: string
}

export type ProviderKind = 'anthropic' | 'openai' | 'demo'

export interface Provider {
  readonly kind: ProviderKind
  send: (request: ProviderRequest) => Promise<ProviderReply>
}

/**
 * Raised when a provider answers with an error.
 *
 * The message is deliberately built from the status and the provider's own text, never from the
 * request -- the request carries the key.
 */
export class ProviderError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}
