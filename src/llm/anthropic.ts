import {
  type ChatMessage,
  type Provider,
  ProviderError,
  type ProviderReply,
  type ProviderRequest,
} from './types'

/**
 * Anthropic's Messages API, called straight from the browser.
 *
 * `anthropic-dangerous-direct-browser-access` is required for a browser-origin request and is
 * exactly as alarming as it sounds: it means the key is in the page. That is a deliberate, stated
 * trade for a static app with no backend -- the key is the visitor's own, it is entered by them,
 * it never leaves their browser except to Anthropic, and the panel says so before they type it.
 * A proxy is the right answer for a hosted product and is in the backlog, not in this app.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'
const MAX_TOKENS = 1024

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5'

interface AnthropicBlock {
  readonly type: string
  readonly text?: string
  readonly id?: string
  readonly name?: string
  readonly input?: Record<string, unknown>
}

interface AnthropicResponse {
  readonly content?: readonly AnthropicBlock[]
  readonly stop_reason?: string
  readonly error?: { readonly message?: string }
}

/** Our messages, in Anthropic's shape: tool results are user-turn content blocks. */
function toAnthropicMessages(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === 'user') {
      return { role: 'user', content: message.content }
    }
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.callId, content: message.content }],
      }
    }
    const content: unknown[] = []
    if (message.content) content.push({ type: 'text', text: message.content })
    for (const call of message.toolCalls) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    }
    return { role: 'assistant', content }
  })
}

export function createAnthropicProvider(apiKey: string, model: string): Provider {
  return {
    kind: 'anthropic',
    async send(request: ProviderRequest): Promise<ProviderReply> {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        ...(request.signal ? { signal: request.signal } : {}),
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system: request.system,
          messages: toAnthropicMessages(request.messages),
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters,
          })),
        }),
      })

      const body = (await response.json().catch(() => ({}))) as AnthropicResponse
      if (!response.ok) {
        throw new ProviderError(response.status, body.error?.message ?? response.statusText)
      }

      const text = (body.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
      const toolCalls = (body.content ?? [])
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({
          id: block.id ?? '',
          name: block.name ?? '',
          input: block.input ?? {},
        }))

      return {
        content: text,
        toolCalls,
        stop: body.stop_reason === 'tool_use' ? 'tool_use' : 'end',
      }
    },
  }
}
