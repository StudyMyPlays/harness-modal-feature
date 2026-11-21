import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimits } from '@/lib/rate-limit'
import { resetCatalogCache } from '@/lib/harness/catalog'
import { collect, sseResponse } from '@/test/streams'
import { readHarnessStream } from '@/lib/harness/protocol'
import modelsFixture from '@/lib/harness/__fixtures__/models.json'
import textFixture from '@/lib/harness/llm/__fixtures__/text.json'

const { POST } = await import('@/app/api/chat/route')

const URL_ = 'http://localhost:3000/api/chat'
const DEEPSEEK = 'deepseek-v4-1-flash-1017-uncensored'
const NO_VISION = 'deepseek-v4-pro'

const settings = { webSearch: 'off', includeVeniceSystemPrompt: false, mcpServers: [] }
const good = { model: DEEPSEEK, messages: [{ role: 'user', content: 'hi' }], settings }

function post(body: unknown, rawBody?: string) {
  return POST(
    new NextRequest(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:3000' },
      body: rawBody ?? JSON.stringify(body),
    }),
  )
}

/** Venice stub: /models gets the catalog fixture, chat gets `chat()`; returns the chat request bodies. */
function stubVenice(chat: () => Response = () => sseResponse(textFixture)) {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/models')) return Response.json(modelsFixture)
      bodies.push(JSON.parse(String(init?.body)))
      return chat()
    }),
  )
  return bodies
}

async function events(res: Response) {
  return collect(readHarnessStream(res))
}

beforeEach(() => {
  resetRateLimits()
  resetCatalogCache()
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('VENICE_API_KEY', 'sk-test')
  vi.stubEnv('VERCEL', '')
  vi.stubEnv('HARNESS_PASSCODE', '')
  vi.stubEnv('HARNESS_MODELS', `${DEEPSEEK},glm-5-3-flash-uncensored,${NO_VISION}`)
  vi.stubEnv('MCP_SERVERS', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/chat', () => {
  it('streams text events for a valid request', async () => {
    stubVenice()
    const res = await post(good)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const types = (await events(res)).map((e) => e.type)
    expect(types).toContain('text-delta')
    expect(types.at(-1)).toBe('done')
  })

  it('refuses unsupported model 400', async () => {
    stubVenice()
    const res = await post({ ...good, model: 'gpt-who' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unsupported model.' })
  })

  it('refuses a malformed body 400', async () => {
    stubVenice()
    expect((await post({ model: DEEPSEEK })).status).toBe(400)
    expect((await post({ ...good, messages: [] })).status).toBe(400)
    expect((await post({ ...good, messages: [{ role: 'assistant', content: 'x' }] })).status).toBe(400)
    expect((await post({ ...good, settings: { ...settings, webSearch: 'always' } })).status).toBe(400)
  })

  it('refuses a client system message after the first 400', async () => {
    stubVenice()
    const res = await post({
      ...good,
      messages: [
        { role: 'system', content: 'a' },
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'sneaky' },
        { role: 'user', content: 'again' },
      ],
    })
    expect(res.status).toBe(400)
  })

  it('refuses images for a non-vision model 400', async () => {
    stubVenice()
    const res = await post({
      ...good,
      model: NO_VISION,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
      ],
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'This model can’t read images.' })
  })

  it('refuses body over 4.4MB 413', async () => {
    stubVenice()
    const big = JSON.stringify({ ...good, messages: [{ role: 'user', content: 'x'.repeat(4_400_001) }] })
    expect((await post(null, big)).status).toBe(413)
  })

  it('upstream 402 streams an error event with friendly message and no upstream text', async () => {
    stubVenice(() => new Response('insufficient balance for key sk-abc', { status: 402 }))
    const res = await post(good)
    const all = await events(res)
    expect(all.at(-1)).toEqual({
      type: 'error',
      message: 'The chat is temporarily unavailable. Please try again later.',
      status: 502,
    })
    expect(JSON.stringify(all)).not.toContain('sk-abc')
  })

  it('system message = client system prompt + preamble', async () => {
    const bodies = stubVenice()
    await events(
      await post({ ...good, messages: [{ role: 'system', content: 'You are terse.' }, { role: 'user', content: 'hi' }] }),
    )
    const messages = bodies[0].messages as { role: string; content: string }[]
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content.startsWith('You are terse.')).toBe(true)
    expect(messages[0].content).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'hi' })
  })

  it('drops reasoningEffort not offered by the model', async () => {
    const bodies = stubVenice()
    await events(await post({ ...good, settings: { ...settings, reasoningEffort: 'xhigh' } }))
    expect(bodies[0]).not.toHaveProperty('reasoning_effort')
    await events(await post({ ...good, settings: { ...settings, reasoningEffort: 'low' } }))
    expect(bodies[1].reasoning_effort).toBe('low')
  })

  it('passes web search and the Venice system prompt switch through', async () => {
    const bodies = stubVenice()
    await events(await post({ ...good, settings: { ...settings, webSearch: 'auto', includeVeniceSystemPrompt: true } }))
    expect(bodies[0].venice_parameters).toEqual({
      enable_web_search: 'auto',
      enable_web_citations: true,
      include_search_results_in_stream: true,
      include_venice_system_prompt: true,
    })
  })

  it('still chats when the model catalog is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/models') ? new Response('down', { status: 503 }) : sseResponse(textFixture),
      ),
    )
    const all = await events(await post(good))
    expect(all.find((e) => e.type === 'usage')).toMatchObject({ costUsd: null })
    expect(all.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
  })

  it('costs usage with catalog pricing', async () => {
    stubVenice()
    const all = await events(await post(good))
    // text fixture: 120 input (100 cached), 8 output at 0.33 / 0.00825 / 1.32 per M
    const expected = (20 * 0.33 + 100 * 0.00825 + 8 * 1.32) / 1e6
    expect((all.find((e) => e.type === 'usage') as { costUsd: number }).costUsd).toBeCloseTo(expected, 12)
  })

  it('refuses temperature outside 0-2', async () => {
    stubVenice()
    expect((await post({ ...good, settings: { ...settings, temperature: 3 } })).status).toBe(400)
  })
})
