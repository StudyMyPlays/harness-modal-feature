import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collect, hangingStream, sseResponse } from '@/test/streams'
import searchFixture from './__fixtures__/search.json'
import textFixture from './__fixtures__/text.json'
import toolsFixture from './__fixtures__/tools.json'
import { LlmError, type LlmEvent, type LlmRequest } from './types'
import {
  VENICE_BASE_URL,
  buildVeniceBody,
  createVeniceAdapter,
  downstreamStatus,
  upstreamMessage,
} from './venice'

function req(over: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    webSearch: 'off',
    includeVeniceSystemPrompt: false,
    signal: new AbortController().signal,
    timeoutMs: 5000,
    ...over,
  }
}

function adapterReturning(res: Response | ((init: RequestInit) => Promise<Response>)) {
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
    typeof res === 'function' ? res(init) : res,
  )
  return { adapter: createVeniceAdapter({ key: 'sk-test', fetchImpl: fetchImpl as unknown as typeof fetch }), fetchImpl }
}

async function errorOf(p: Promise<unknown>): Promise<LlmError> {
  try {
    await p
  } catch (e) {
    return e as LlmError
  }
  throw new Error('expected a throw')
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.useRealTimers())

describe('createVeniceAdapter', () => {
  it('posts to chat/completions with the bearer key', async () => {
    const { adapter, fetchImpl } = adapterReturning(sseResponse(textFixture))
    await collect(adapter.stream(req()))
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${VENICE_BASE_URL}/chat/completions`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('maps reasoning, text and usage in order', async () => {
    const { adapter } = adapterReturning(
      sseResponse(textFixture, { headers: { 'x-venice-balance-usd': '12.5' } }),
    )
    const events = await collect(adapter.stream(req()))
    expect(events.map((e) => e.type)).toEqual([
      'meta',
      'reasoning-delta',
      'text-delta',
      'text-delta',
      'usage',
      'finish',
    ])
    expect(events[0]).toEqual({ type: 'meta', balanceUsd: 12.5 })
    expect(events.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      usage: { inputTokens: 120, outputTokens: 8, cachedInputTokens: 100 },
    })
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'stop' })
  })

  it('reports a null balance when no balance header is sent', async () => {
    const { adapter } = adapterReturning(sseResponse(textFixture))
    const events = await collect(adapter.stream(req()))
    expect(events[0]).toEqual({ type: 'meta', balanceUsd: null })
  })

  it('accumulates split tool-call arguments into one tool-calls event', async () => {
    const { adapter } = adapterReturning(sseResponse(toolsFixture))
    const events = await collect(adapter.stream(req()))
    const calls = events.filter((e) => e.type === 'tool-calls')
    expect(calls).toHaveLength(1)
    const [{ calls: list }] = calls as Extract<LlmEvent, { type: 'tool-calls' }>[]
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({
      id: 'call_a',
      type: 'function',
      function: { name: 'search', arguments: '{"q":"cats"}' },
    })
    expect(list[1].function.name).toBe('clock')
    // tool-calls comes before finish, and finish says why
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' })
    expect(events.findIndex((e) => e.type === 'tool-calls')).toBeLessThan(events.length - 1)
  })

  it('emits citations from the chunk that carries them (Venice sends it after the text)', async () => {
    const { adapter } = adapterReturning(sseResponse(searchFixture))
    const events = await collect(adapter.stream(req({ webSearch: 'on' })))
    expect(events.map((e) => e.type)).toEqual(['meta', 'text-delta', 'citations', 'usage', 'finish'])
    expect(events[2]).toEqual({
      type: 'citations',
      citations: [
        { title: 'Cats', url: 'https://example.com/cats', content: 'About cats' },
        { title: 'Dogs', url: 'https://example.com/dogs' },
      ],
    })
  })

  it('non-2xx throws LlmError upstream with status and never includes body text', async () => {
    const { adapter } = adapterReturning(
      new Response(JSON.stringify({ error: 'insufficient balance sk-xx' }), { status: 402 }),
    )
    const err = await errorOf(collect(adapter.stream(req())))
    expect(err).toBeInstanceOf(LlmError)
    expect(err.kind).toBe('upstream')
    expect(err.status).toBe(402)
    expect(err.message).not.toContain('sk-xx')
  })

  it('aborting the caller signal throws kind aborted', async () => {
    const ctrl = new AbortController()
    const { adapter } = adapterReturning(async (init) => new Response(hangingStream(init.signal ?? undefined)))
    const p = errorOf(collect(adapter.stream(req({ signal: ctrl.signal }))))
    setTimeout(() => ctrl.abort(), 5)
    expect((await p).kind).toBe('aborted')
  })

  it('timeout throws kind timeout', async () => {
    const { adapter } = adapterReturning(async (init) => new Response(hangingStream(init.signal ?? undefined)))
    const err = await errorOf(collect(adapter.stream(req({ timeoutMs: 10 }))))
    expect(err.kind).toBe('timeout')
  })

  it('a fetch that rejects before answering is a transport error', async () => {
    const { adapter } = adapterReturning(async () => {
      throw new TypeError('fetch failed')
    })
    expect((await errorOf(collect(adapter.stream(req())))).kind).toBe('transport')
  })

  it('empty stream throws kind empty', async () => {
    const { adapter } = adapterReturning(
      sseResponse([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
    )
    expect((await errorOf(collect(adapter.stream(req())))).kind).toBe('empty')
  })

  it('skips malformed chunks instead of failing the stream', async () => {
    const { adapter } = adapterReturning(sseResponse(['not json', ...textFixture]))
    const events = await collect(adapter.stream(req()))
    expect(events.filter((e) => e.type === 'text-delta')).toHaveLength(2)
  })
})

describe('buildVeniceBody', () => {
  it('sets venice_parameters', () => {
    const body = buildVeniceBody(req({ webSearch: 'auto' }))
    expect(body.venice_parameters).toEqual({
      enable_web_search: 'auto',
      enable_web_citations: true,
      // Without it Venice streams the ^n^ carets but never the sources they point to.
      include_search_results_in_stream: true,
      include_venice_system_prompt: false,
    })
    expect(body).not.toHaveProperty('tools')
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('turns citations off with search off and passes optional fields only when set', () => {
    const body = buildVeniceBody(
      req({ includeVeniceSystemPrompt: true, reasoningEffort: 'low', temperature: 0.2, maxTokens: 30 }),
    )
    expect(body.venice_parameters).toMatchObject({
      enable_web_search: 'off',
      enable_web_citations: false,
      include_search_results_in_stream: false,
      include_venice_system_prompt: true,
    })
    expect(body).toMatchObject({ reasoning_effort: 'low', temperature: 0.2, max_tokens: 30 })
    expect(buildVeniceBody(req())).not.toHaveProperty('reasoning_effort')
    expect(buildVeniceBody(req())).not.toHaveProperty('temperature')
  })

  it('maps tools to the OpenAI function shape', () => {
    const body = buildVeniceBody(
      req({ tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }] }),
    )
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } },
    ])
  })
})

describe('error mapping', () => {
  it('upstreamMessage names the feature and hides account detail', () => {
    expect(upstreamMessage(401, 'The chat')).toBe('The chat could not authenticate with the model provider.')
    expect(upstreamMessage(402, 'The chat')).toBe('The chat is temporarily unavailable. Please try again later.')
    expect(upstreamMessage(429, 'The chat')).toBe('The chat is busy right now. Try again in a moment.')
    expect(upstreamMessage(503)).toBe('The model provider is having trouble. Try again in a moment.')
    expect(upstreamMessage(400, 'The chat')).toBe('The chat could not process that request.')
  })

  it('downstreamStatus keeps 429 and reports everything else as 502', () => {
    expect(downstreamStatus(429)).toBe(429)
    expect(downstreamStatus(401)).toBe(502)
    expect(downstreamStatus(500)).toBe(502)
  })
})
