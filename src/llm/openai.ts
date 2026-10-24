import {
  type ChatMessage,
  type Provider,
  ProviderError,
  type ProviderReply,
  type ProviderRequest,
} from './types'

/**
 * Anything that speaks OpenAI's chat-completions shape.
 *
 * Which is most things: OpenAI itself, xAI, Together, Groq, an Ollama or vLLM gateway on
 * localhost. The base URL is a field rather than a constant precisely so a local model works
 * without a key leaving the machine at all.
 */

const MAX_TOKENS = 1024

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini'

interface OpenAiToolCall {
  readonly id?: string
  readonly function?: { readonly name?: string; readonly arguments?: string }
}

interface OpenAiResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null
      readonly tool_calls?: readonly OpenAiToolCall[]
    }
    readonly finish_reason?: string
  }[]
  readonly error?: { readonly message?: string }
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    // A model that emits malformed JSON gets an empty object and, through the dispatcher, a
    // message saying the call had nothing to change. Better than throwing away the whole turn.
    return {}
  }
}

function toOpenAiMessages(system: string, messages: readonly ChatMessage[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content })
    } else if (message.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: message.callId, content: message.content })
    } else {
      out.push({
        role: 'assistant',
        content: message.content || null,
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      })
    }
  }
  return out
}

export function createOpenAiProvider(apiKey: string, model: string, baseUrl: string): Provider {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  return {
    kind: 'openai',
    async send(request: ProviderRequest): Promise<ProviderReply> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        ...(request.signal ? { signal: request.signal } : {}),
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          messages: toOpenAiMessages(request.system, request.messages),
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }),
      })

      const body = (await response.json().catch(() => ({}))) as OpenAiResponse
      if (!response.ok) {
        throw new ProviderError(response.status, body.error?.message ?? response.statusText)
      }

      const choice = body.choices?.[0]
      const toolCalls = (choice?.message?.tool_calls ?? []).map((call) => ({
        id: call.id ?? '',
        name: call.function?.name ?? '',
        input: parseArguments(call.function?.arguments),
      }))

      return {
        content: choice?.message?.content ?? '',
        toolCalls,
        stop: toolCalls.length > 0 ? 'tool_use' : 'end',
      }
    },
  }
}
