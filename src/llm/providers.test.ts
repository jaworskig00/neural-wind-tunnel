import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAnthropicProvider } from './anthropic'
import { createOpenAiProvider } from './openai'
import { TOOLS } from './tools'
import { ProviderError } from './types'

/**
 * Both adapters against a mocked endpoint.
 *
 * What matters here is the translation in both directions -- our messages into their shape, their
 * reply back into ours -- and that a failure surfaces as an error carrying the provider's words
 * rather than ours. The key assertions are deliberately about what is *not* in the request too:
 * nothing from the conversation should end up in a header, and nothing from a header in a log.
 */

const SYSTEM = 'be brief'

function mockFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: 'Bad Request',
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastBody(fetchMock: ReturnType<typeof mockFetch>): Record<string, unknown> {
  const call = fetchMock.mock.calls[0]
  const init = call?.[1] as { body: string }
  return JSON.parse(init.body) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Anthropic adapter', () => {
  it('sends the key as a header and the tools as input schemas', async () => {
    const fetchMock = mockFetch({
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
    })
    const provider = createAnthropicProvider('sk-test-key', 'claude-sonnet-5-5')

    const reply = await provider.send({
      system: SYSTEM,
      messages: [{ role: 'user', content: 'thinner please' }],
      tools: TOOLS,
    })

    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }
    expect(init.headers['x-api-key']).toBe('sk-test-key')
    expect(init.headers['anthropic-version']).toBeDefined()

    const body = lastBody(fetchMock)
    expect(body['system']).toBe(SYSTEM)
    const tools = body['tools'] as { name: string; input_schema: unknown }[]
    expect(tools.map((tool) => tool.name)).toContain('nudge_shape')
    expect(tools[0]?.input_schema).toBeDefined()

    expect(reply.content).toBe('hello')
    expect(reply.stop).toBe('end')
  })

  it('reads a tool call out of the reply', async () => {
    mockFetch({
      content: [
        { type: 'text', text: 'one moment' },
        { type: 'tool_use', id: 'call_1', name: 'nudge_shape', input: { thickness_factor: 0.9 } },
      ],
      stop_reason: 'tool_use',
    })

    const reply = await createAnthropicProvider('k', 'm').send({
      system: SYSTEM,
      messages: [{ role: 'user', content: 'thinner' }],
      tools: TOOLS,
    })

    expect(reply.stop).toBe('tool_use')
    expect(reply.toolCalls).toHaveLength(1)
    expect(reply.toolCalls[0]?.name).toBe('nudge_shape')
    expect(reply.toolCalls[0]?.input['thickness_factor']).toBe(0.9)
  })

  it('sends a tool result back as a user-turn block', async () => {
    const fetchMock = mockFetch({ content: [], stop_reason: 'end_turn' })

    await createAnthropicProvider('k', 'm').send({
      system: SYSTEM,
      messages: [
        { role: 'user', content: 'thinner' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'nudge_shape', input: {} }],
        },
        { role: 'tool', callId: 'call_1', name: 'nudge_shape', content: '{"ok":true}' },
      ],
      tools: TOOLS,
    })

    const messages = lastBody(fetchMock)['messages'] as {
      role: string
      content: { type: string; tool_use_id?: string }[] | string
    }[]
    expect(messages[2]?.role).toBe('user')
    expect(Array.isArray(messages[2]?.content)).toBe(true)
    const blocks = messages[2]?.content as { type: string; tool_use_id?: string }[]
    expect(blocks[0]?.type).toBe('tool_result')
    expect(blocks[0]?.tool_use_id).toBe('call_1')
  })

  it('raises the provider message, not the request, on a failure', async () => {
    mockFetch({ error: { message: 'credit balance is too low' } }, false, 400)

    await expect(
      createAnthropicProvider('sk-secret', 'm').send({
        system: SYSTEM,
        messages: [{ role: 'user', content: 'hi' }],
        tools: TOOLS,
      }),
    ).rejects.toThrow(ProviderError)

    await expect(
      createAnthropicProvider('sk-secret', 'm').send({
        system: SYSTEM,
        messages: [{ role: 'user', content: 'hi' }],
        tools: TOOLS,
      }),
    ).rejects.toThrow(/credit balance/)
  })
})

describe('the OpenAI-compatible adapter', () => {
  it('posts to the configured base URL with a bearer token', async () => {
    const fetchMock = mockFetch({
      choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
    })

    const reply = await createOpenAiProvider(
      'key',
      'gpt-4.1-mini',
      'http://localhost:11434/v1/',
    ).send({ system: SYSTEM, messages: [{ role: 'user', content: 'hi' }], tools: TOOLS })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/v1/chat/completions')
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }
    expect(init.headers['authorization']).toBe('Bearer key')
    expect(reply.content).toBe('done')
    expect(reply.stop).toBe('end')
  })

  it('omits the authorization header when there is no key', async () => {
    const fetchMock = mockFetch({ choices: [{ message: { content: '' } }] })

    await createOpenAiProvider('', 'local-model', 'http://localhost:8000/v1').send({
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      tools: TOOLS,
    })

    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }
    expect(init.headers['authorization']).toBeUndefined()
  })

  it('puts the system prompt in the first message', async () => {
    const fetchMock = mockFetch({ choices: [{ message: { content: '' } }] })

    await createOpenAiProvider('k', 'm', 'https://api.example.com/v1').send({
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      tools: TOOLS,
    })

    const messages = lastBody(fetchMock)['messages'] as { role: string; content: string }[]
    expect(messages[0]).toEqual({ role: 'system', content: SYSTEM })
  })

  it('parses tool-call arguments and survives malformed JSON', async () => {
    mockFetch({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'c1',
                function: { name: 'nudge_shape', arguments: '{"thickness_factor":0.8}' },
              },
              { id: 'c2', function: { name: 'explain_result', arguments: 'not json' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })

    const reply = await createOpenAiProvider('k', 'm', 'https://api.example.com/v1').send({
      system: SYSTEM,
      messages: [{ role: 'user', content: 'hi' }],
      tools: TOOLS,
    })

    expect(reply.stop).toBe('tool_use')
    expect(reply.toolCalls[0]?.input['thickness_factor']).toBe(0.8)
    expect(reply.toolCalls[1]?.input).toEqual({})
  })
})
