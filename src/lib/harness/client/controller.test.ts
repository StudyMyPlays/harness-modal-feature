import { beforeEach, describe, expect, it, vi } from 'vitest'
import modelsFixture from '@/lib/harness/__fixtures__/models.json'
import { encodeEvent, type HarnessEvent } from '@/lib/harness/protocol'
import type { AssistantMessageEvent, ChatSettings, UserMessageEvent } from '@/lib/harness/session/format'
import { createMemoryStore, type SessionStore } from '@/lib/harness/session/store'
import { createChatController, loadDefaults, saveDefaults, type ChatController } from './controller'

const DEEPSEEK = 'deepseek-v4-1-flash-1017-uncensored'
const GLM = 'glm-5-3-flash-uncensored'

const catalog = {
  models: [] as unknown[],
  defaultModel: DEEPSEEK,
  utilityModel: GLM,
  compactAtTokens: 150_000,
}

// Map the raw fixture through the same shape /api/models returns.
const { getModelCatalog, resetCatalogCache } = await import('@/lib/harness/catalog')
resetCatalogCache()
catalog.models = await getModelCatalog({
  key: 'k',
  allow: [DEEPSEEK, GLM, 'deepseek-v4-pro'],
  fetchImpl: (async () => Response.json(modelsFixture)) as unknown as typeof fetch,
})

function sse(events: HarnessEvent[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(encodeEvent(e))
      c.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

const reply = (text: string, extra: HarnessEvent[] = []): HarnessEvent[] => [
  { type: 'meta', balanceUsd: 7.5 },
  { type: 'step-start', step: 1 },
  { type: 'reasoning-delta', text: 'thinking' },
  { type: 'text-delta', text: text.slice(0, 2) },
  { type: 'text-delta', text: text.slice(2) },
  ...extra,
  { type: 'step-end', step: 1, finishReason: 'stop' },
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 }, costUsd: 0.002 },
  { type: 'done', finishReason: 'stop' },
]

type Handler = (body: unknown, init: RequestInit) => Response | Promise<Response>

function fakeFetch(routes: Partial<Record<'/api/models' | '/api/chat' | '/api/title' | '/api/compact', Handler>>) {
  const calls: { url: string; body: unknown }[] = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, body })
    const handler =
      routes[url as keyof typeof routes] ??
      (url === '/api/models' ? () => Response.json(catalog) : url === '/api/title' ? () => Response.json({ title: 'Auto Title' }) : undefined)
    if (!handler) throw new Error(`unexpected fetch ${url}`)
    return handler(body, init)
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

function file(name: string, type: string, size = 10): File {
  return new File(['x'.repeat(size)], name, { type })
}

let store: SessionStore
let clock: number
let ids: number

function make(fetchImpl: typeof fetch, over: Partial<Parameters<typeof createChatController>[0]> = {}): ChatController {
  return createChatController({
    store,
    fetchImpl,
    now: () => clock++,
    newId: () => `id${++ids}`,
    flushMs: 0,
    readFile: async (f) => `data:${f.type || 'application/octet-stream'};base64,QUJD`,
    storage: null,
    ...over,
  })
}

function lastAssistant(c: ChatController) {
  return c.getState().events.filter((e) => e.type === 'assistant-message').at(-1) as AssistantMessageEvent
}

beforeEach(() => {
  store = createMemoryStore()
  clock = 1_000
  ids = 0
})

describe('chat controller', () => {
  it('init loads models and opens the most recent chat', async () => {
    const { fetchImpl } = fakeFetch({ '/api/chat': () => sse(reply('Hello')) })
    const c = make(fetchImpl)
    await c.init()
    expect(c.getState().models.map((m) => m.id)).toEqual([DEEPSEEK, GLM, 'deepseek-v4-pro'])
    expect(c.getState().activeChatId).toBeNull()
    const id = await c.newChat()
    const c2 = make(fetchImpl)
    await c2.init()
    expect(c2.getState().activeChatId).toBe(id)
  })

  it('send streams into an assistant event and completes', async () => {
    const { fetchImpl, calls } = fakeFetch({ '/api/chat': () => sse(reply('Hello')) })
    const c = make(fetchImpl)
    await c.init()
    await c.send('  hi there  ', [])
    const state = c.getState()
    const [user, assistant] = state.events as [UserMessageEvent, AssistantMessageEvent]
    expect(user).toMatchObject({ type: 'user-message', text: 'hi there' })
    expect(assistant).toMatchObject({
      type: 'assistant-message',
      model: DEEPSEEK,
      status: 'complete',
      finishReason: 'stop',
      costUsd: 0.002,
    })
    expect(assistant.steps).toEqual([{ reasoning: 'thinking', text: 'Hello', citations: [], toolCalls: [] }])
    expect(state.streaming).toBe(false)
    expect(state.balanceUsd).toBe(7.5)
    const chat = state.chats.find((x) => x.id === state.activeChatId)!
    expect(chat.totals).toEqual({ inputTokens: 100, outputTokens: 10, costUsd: 0.002 })
    const chatCall = calls.find((x) => x.url === '/api/chat')!
    expect(chatCall.body).toEqual({
      model: DEEPSEEK,
      messages: [{ role: 'user', content: 'hi there' }],
      settings: { webSearch: 'off', includeVeniceSystemPrompt: false, mcpServers: [] },
    })
    // persisted
    expect((await store.listEvents(state.activeChatId!)).at(-1)).toMatchObject({ status: 'complete' })
  })

  it('send resolves true when the message was accepted', async () => {
    const { fetchImpl } = fakeFetch({ '/api/chat': () => sse(reply('ok')) })
    const c = make(fetchImpl)
    await c.init()
    expect(await c.send('hi', [])).toBe(true)
    expect(await c.send('   ', [])).toBe(false)
  })

  it('sends the system prompt, effort and temperature from chat settings', async () => {
    const { fetchImpl, calls } = fakeFetch({ '/api/chat': () => sse(reply('ok')) })
    const c = make(fetchImpl)
    await c.init()
    await c.newChat({ systemPrompt: 'Be terse.', reasoningEffort: 'low', temperature: 0.4, webSearch: 'auto' })
    await c.send('hi', [])
    expect(calls.find((x) => x.url === '/api/chat')!.body).toMatchObject({
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'hi' },
      ],
      settings: { reasoningEffort: 'low', temperature: 0.4, webSearch: 'auto' },
    })
  })

  it('records tool calls, results and citations on the step', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/chat': () =>
        sse([
          { type: 'step-start', step: 1 },
          { type: 'tool-call', id: 't1', name: 'mcp__docs__search', args: '{}' },
          { type: 'tool-result', id: 't1', result: { ok: true, content: 'found', truncated: false } },
          { type: 'step-end', step: 1, finishReason: 'tool_calls' },
          { type: 'step-start', step: 2 },
          { type: 'citations', citations: [{ title: 'A', url: 'https://a.example' }] },
          { type: 'text-delta', text: 'Answer^1^' },
          { type: 'done', finishReason: 'stop' },
        ]),
    })
    const c = make(fetchImpl)
    await c.init()
    await c.send('q', [])
    expect(lastAssistant(c).steps).toEqual([
      {
        reasoning: '',
        text: '',
        citations: [],
        toolCalls: [{ id: 't1', name: 'mcp__docs__search', args: '{}', result: { ok: true, content: 'found', truncated: false } }],
      },
      { reasoning: '', text: 'Answer^1^', citations: [{ title: 'A', url: 'https://a.example' }], toolCalls: [] },
    ])
  })

  it('persists partial text during streaming (flushMs) so reload keeps it', async () => {
    let push!: (e: HarnessEvent) => void
    const { fetchImpl } = fakeFetch({
      '/api/chat': (_b, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              push = (e) => ctrl.enqueue(encodeEvent(e))
              // Like a real fetch body, an abort errors the stream.
              init.signal?.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError')))
            },
          }),
        ),
    })
    const c = make(fetchImpl)
    await c.init()
    const sending = c.send('hi', [])
    await vi.waitFor(() => expect(push).toBeDefined())
    push({ type: 'step-start', step: 1 })
    push({ type: 'text-delta', text: 'Partial ans' })
    const chatId = c.getState().activeChatId!
    await vi.waitFor(async () => {
      const saved = (await store.listEvents(chatId)).at(-1) as AssistantMessageEvent
      expect(saved.steps[0]?.text).toBe('Partial ans')
      expect(saved.status).toBe('streaming')
    })
    // The tab goes away mid-stream: a new controller on the same store.
    const reloaded = make(fetchImpl)
    await reloaded.init()
    expect(lastAssistant(reloaded)).toMatchObject({ status: 'interrupted' })
    expect(lastAssistant(reloaded).steps[0].text).toBe('Partial ans')
    expect(((await store.listEvents(chatId)).at(-1) as AssistantMessageEvent).status).toBe('interrupted')
    c.stop()
    await sending
  })

  it('init marks leftover streaming events as interrupted', async () => {
    const { fetchImpl } = fakeFetch({})
    const c = make(fetchImpl)
    await c.init()
    const chatId = await c.newChat()
    await store.putEvent({
      id: 'stale',
      chatId,
      ts: 5,
      v: 1,
      type: 'assistant-message',
      model: DEEPSEEK,
      steps: [],
      status: 'streaming',
      finishReason: null,
      error: null,
      usage: null,
      costUsd: null,
    })
    const c2 = make(fetchImpl)
    await c2.init()
    expect(lastAssistant(c2).status).toBe('interrupted')
  })

  it('stop aborts and marks interrupted', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/chat': (_b, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              ctrl.enqueue(encodeEvent({ type: 'step-start', step: 1 }))
              ctrl.enqueue(encodeEvent({ type: 'text-delta', text: 'so far' }))
              init.signal?.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError')))
            },
          }),
        ),
    })
    const c = make(fetchImpl)
    await c.init()
    const sending = c.send('hi', [])
    await vi.waitFor(() => expect(lastAssistant(c)?.steps[0]?.text).toBe('so far'))
    c.stop()
    await sending
    expect(lastAssistant(c)).toMatchObject({ status: 'interrupted', finishReason: 'aborted' })
    expect(c.getState().streaming).toBe(false)
  })

  it('server error event marks assistant message error and keeps user message', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/chat': () =>
        sse([
          { type: 'step-start', step: 1 },
          { type: 'error', message: 'The chat is busy right now. Try again in a moment.', status: 429 },
        ]),
    })
    const c = make(fetchImpl)
    await c.init()
    await c.send('hi', [])
    expect(c.getState().events[0]).toMatchObject({ type: 'user-message', text: 'hi' })
    expect(lastAssistant(c)).toMatchObject({
      status: 'error',
      error: { message: 'The chat is busy right now. Try again in a moment.', status: 429 },
    })
  })

  it('HTTP 401 JSON error marks error with its message', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/chat': () => Response.json({ error: 'Enter the passcode to continue.' }, { status: 401 }),
    })
    const c = make(fetchImpl)
    await c.init()
    await c.send('hi', [])
    expect(lastAssistant(c)).toMatchObject({
      status: 'error',
      error: { message: 'Enter the passcode to continue.', status: 401 },
    })
  })

  it('a stream that ends without done is an error, not a silent stop', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/chat': () => sse([{ type: 'step-start', step: 1 }, { type: 'text-delta', text: 'cut' }]),
    })
    const c = make(fetchImpl)
    await c.init()
    await c.send('hi', [])
    expect(lastAssistant(c)).toMatchObject({ status: 'error' })
    expect(lastAssistant(c).steps[0].text).toBe('cut')
  })

  it('refuses oversize file with notice and writes nothing', async () => {
    const { fetchImpl, calls } = fakeFetch({})
    const c = make(fetchImpl)
    await c.init()
    const id = await c.newChat()
    expect(await c.send('see', [file('huge.pdf', 'application/pdf', 2_900_001)])).toBe(false)
    expect(c.getState().notice).toBe('"huge.pdf" is over 2.9 MB.')
    expect(await store.listEvents(id)).toEqual([])
    expect(calls.some((x) => x.url === '/api/chat')).toBe(false)
  })

  it('refuses an image for a model without vision', async () => {
    const { fetchImpl } = fakeFetch({})
    const c = make(fetchImpl)
    await c.init()
    await c.newChat({ model: 'deepseek-v4-pro' })
    await c.send('see', [file('cat.png', 'image/png')])
    expect(c.getState().notice).toBe('This model can’t read images.')
  })

  it('refuses a message whose attachments alone exceed the request budget, and writes nothing', async () => {
    const { fetchImpl, calls } = fakeFetch({ '/api/chat': () => sse(reply('x')) })
    // Each data URL is ~1.5 MB, three of them are over the 4 MB budget.
    const big = 'A'.repeat(1_500_000)
    const c = make(fetchImpl, { readFile: async () => `data:application/pdf;base64,${big}` })
    await c.init()
    const id = await c.newChat()
    await c.send('three docs', [
      file('a.pdf', 'application/pdf'),
      file('b.pdf', 'application/pdf'),
      file('c.pdf', 'application/pdf'),
    ])
    expect(c.getState().notice).toBe(
      'This message is over the 4 MB limit per request. Remove an attachment or shorten it.',
    )
    expect(await store.listEvents(id)).toEqual([])
    expect((await store.getAttachments(id)).size).toBe(0)
    expect(calls.some((x) => x.url === '/api/chat')).toBe(false)
  })

  it('a message over budget on its own is refused without a compaction call', async () => {
    const { fetchImpl, calls } = fakeFetch({
      '/api/chat': () => sse(reply('a reply long enough to count')),
      '/api/compact': () => Response.json({ summary: 'should not be asked for' }),
    })
    const big = 'A'.repeat(1_500_000)
    let docs = false
    const c = make(fetchImpl, {
      readFile: async (f) => (docs ? `data:application/pdf;base64,${big}` : `data:${f.type};base64,QUJD`),
    })
    await c.init()
    for (let i = 0; i < 4; i++) await c.send(`turn ${i}`, [])
    docs = true
    const accepted = await c.send('three docs', [
      file('a.pdf', 'application/pdf'),
      file('b.pdf', 'application/pdf'),
      file('c.pdf', 'application/pdf'),
    ])
    expect(accepted).toBe(false)
    expect(calls.some((x) => x.url === '/api/compact')).toBe(false)
    expect(c.getState().events.some((e) => e.type === 'compaction')).toBe(false)
    expect(c.getState().notice).toBe(
      'This message is over the 4 MB limit per request. Remove an attachment or shorten it.',
    )
  })

  it('sends attachments as content parts', async () => {
    const { fetchImpl, calls } = fakeFetch({ '/api/chat': () => sse(reply('ok')) })
    const c = make(fetchImpl)
    await c.init()
    await c.send('read', [file('r.pdf', 'application/pdf')])
    const body = calls.find((x) => x.url === '/api/chat')!.body as { messages: { content: unknown }[] }
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'read' },
      { type: 'file', file: { filename: 'r.pdf', file_data: 'data:application/pdf;base64,QUJD' } },
    ])
    const user = c.getState().events[0] as UserMessageEvent
    expect(user.attachments).toEqual([{ id: expect.any(String), name: 'r.pdf', mime: 'application/pdf', size: 10, kind: 'file' }])
  })

  it('refuses send while streaming', async () => {
    let push!: (e: HarnessEvent) => void
    const { fetchImpl, calls } = fakeFetch({
      '/api/chat': () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              push = (e) => {
                ctrl.enqueue(encodeEvent(e))
                if (e.type === 'done') ctrl.close()
              }
            },
          }),
        ),
    })
    const c = make(fetchImpl)
    await c.init()
    const first = c.send('one', [])
    await vi.waitFor(() => expect(push).toBeDefined())
    await c.send('two', [])
    push({ type: 'done', finishReason: 'stop' })
    await first
    expect(calls.filter((x) => x.url === '/api/chat')).toHaveLength(1)
    expect(c.getState().events.filter((e) => e.type === 'user-message')).toHaveLength(1)
  })

  it('first complete reply sets auto title; title failure uses fallback', async () => {
    const { fetchImpl, calls } = fakeFetch({ '/api/chat': () => sse(reply('Hello')) })
    const c = make(fetchImpl)
    await c.init()
    await c.send('Plan a weekend in Lisbon', [])
    const chat = () => c.getState().chats.find((x) => x.id === c.getState().activeChatId)!
    expect(chat()).toMatchObject({ title: 'Auto Title', titleSource: 'auto' })
    expect(calls.find((x) => x.url === '/api/title')!.body).toEqual({
      userText: 'Plan a weekend in Lisbon',
      assistantText: 'Hello',
    })
    // Second reply does not re-title.
    await c.send('more', [])
    expect(calls.filter((x) => x.url === '/api/title')).toHaveLength(1)

    const failing = fakeFetch({
      '/api/chat': () => sse(reply('Hi')),
      '/api/title': () => Response.json({ error: 'nope' }, { status: 502 }),
    })
    const c2 = make(failing.fetchImpl)
    await c2.init()
    await c2.newChat()
    await c2.send('Write a haiku about autumn leaves falling softly', [])
    expect(c2.getState().chats.find((x) => x.id === c2.getState().activeChatId)).toMatchObject({
      title: 'Write a haiku about autumn leaves…',
      titleSource: 'fallback',
    })
  })

  it('compacts before sending when over compactAtTokens', async () => {
    const { fetchImpl, calls } = fakeFetch({
      '/api/models': () => Response.json({ ...catalog, compactAtTokens: 20 }),
      '/api/chat': () => sse(reply('a reply long enough to count')),
      '/api/compact': () => Response.json({ summary: 'They talked a lot.' }),
    })
    const c = make(fetchImpl)
    await c.init()
    for (let i = 0; i < 4; i++) await c.send(`message number ${i} with some words`, [])
    expect(calls.some((x) => x.url === '/api/compact')).toBe(true)
    const compaction = c.getState().events.find((e) => e.type === 'compaction')
    expect(compaction).toMatchObject({ summary: 'They talked a lot.' })
    const lastChat = calls.filter((x) => x.url === '/api/chat').at(-1)!.body as { messages: { content: string }[] }
    expect(lastChat.messages[0].content).toBe('[Summary of earlier conversation]\nThey talked a lot.')
    const compactBody = calls.find((x) => x.url === '/api/compact')!.body as { messages: { role: string; content: string }[] }
    expect(compactBody.messages[0]).toEqual({ role: 'user', content: 'message number 0 with some words' })
    expect(compactBody.messages.every((m) => typeof m.content === 'string')).toBe(true)
  })

  it('a failed compaction is reported and the message still sends', async () => {
    const { fetchImpl, calls } = fakeFetch({
      '/api/models': () => Response.json({ ...catalog, compactAtTokens: 20 }),
      '/api/chat': () => sse(reply('a reply long enough to count')),
      '/api/compact': () => Response.json({ error: 'busy' }, { status: 429 }),
    })
    const c = make(fetchImpl)
    await c.init()
    for (let i = 0; i < 4; i++) await c.send(`message number ${i} with some words`, [])
    expect(calls.filter((x) => x.url === '/api/chat')).toHaveLength(4)
    expect(c.getState().notice).toBe('Couldn’t summarise older messages; sending the full history.')
  })

  it('compactNow with too little history says so', async () => {
    const { fetchImpl } = fakeFetch({ '/api/chat': () => sse(reply('ok')) })
    const c = make(fetchImpl)
    await c.init()
    await c.send('hi', [])
    await c.compactNow()
    expect(c.getState().notice).toBe('There isn’t enough history to summarise yet.')
  })

  it('regenerate replaces last assistant message', async () => {
    let n = 0
    const { fetchImpl } = fakeFetch({ '/api/chat': () => sse(reply(`Reply ${++n}`)) })
    const c = make(fetchImpl)
    await c.init()
    await c.send('hi', [])
    await c.regenerate()
    const assistants = c.getState().events.filter((e) => e.type === 'assistant-message') as AssistantMessageEvent[]
    expect(assistants).toHaveLength(1)
    expect(assistants[0].steps[0].text).toBe('Reply 2')
    expect(await store.listEvents(c.getState().activeChatId!)).toHaveLength(2)
  })

  it('editLastUserMessage replaces text and drops later events', async () => {
    const { fetchImpl, calls } = fakeFetch({ '/api/chat': () => sse(reply('ok')) })
    const c = make(fetchImpl)
    await c.init()
    await c.send('first', [])
    await c.send('secnod', [])
    await c.editLastUserMessage('second')
    const users = c.getState().events.filter((e) => e.type === 'user-message') as UserMessageEvent[]
    expect(users.map((u) => u.text)).toEqual(['first', 'second'])
    expect(c.getState().events).toHaveLength(4)
    const last = calls.filter((x) => x.url === '/api/chat').at(-1)!.body as { messages: { content: string }[] }
    expect(last.messages.at(-1)).toEqual({ role: 'user', content: 'second' })
  })

  it('deleteChat removes it and opens the next most recent', async () => {
    const { fetchImpl } = fakeFetch({})
    const c = make(fetchImpl)
    await c.init()
    const a = await c.newChat()
    const b = await c.newChat()
    await c.deleteChat(b)
    expect(c.getState().activeChatId).toBe(a)
    expect(c.getState().chats.map((x) => x.id)).toEqual([a])
    await c.deleteChat(a)
    expect(c.getState().activeChatId).toBeNull()
  })

  it('deleting a chat while it streams removes it for good', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/chat': (_b, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              ctrl.enqueue(encodeEvent({ type: 'step-start', step: 1 }))
              ctrl.enqueue(encodeEvent({ type: 'text-delta', text: 'partial' }))
              init.signal?.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError')))
            },
          }),
        ),
    })
    const c = make(fetchImpl)
    await c.init()
    const sending = c.send('hi', [])
    await vi.waitFor(() => expect(lastAssistant(c)?.steps[0]?.text).toBe('partial'))
    const id = c.getState().activeChatId!
    await c.deleteChat(id)
    await sending
    expect(await store.getChat(id)).toBeNull()
    expect(await store.listEvents(id)).toEqual([])
    expect(c.getState().chats).toEqual([])
  })

  it('renameChat marks the title as the user’s', async () => {
    const { fetchImpl } = fakeFetch({})
    const c = make(fetchImpl)
    await c.init()
    const id = await c.newChat()
    await c.renameChat(id, '  My plans  ')
    expect(c.getState().chats[0]).toMatchObject({ title: 'My plans', titleSource: 'user' })
  })

  it('updateSettings merges and persists', async () => {
    const { fetchImpl } = fakeFetch({})
    const c = make(fetchImpl)
    await c.init()
    const id = await c.newChat()
    await c.updateSettings(id, { webSearch: 'on' })
    expect((await store.getChat(id))!.settings).toMatchObject({ webSearch: 'on', model: DEEPSEEK })
  })

  it('surfaces a failed /api/models as a notice', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/models': () => Response.json({ error: 'The harness isn’t configured: set VENICE_API_KEY.' }, { status: 503 }),
    })
    const c = make(fetchImpl)
    await c.init()
    expect(c.getState().notice).toBe('The harness isn’t configured: set VENICE_API_KEY.')
  })
})

describe('defaults', () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>()
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      length: 0,
    }
  }

  it('newChat uses stored defaults and falls back when the stored model is gone', async () => {
    const storage = memoryStorage()
    const stored: ChatSettings = {
      model: GLM,
      systemPrompt: 'Saved prompt',
      reasoningEffort: 'low',
      temperature: null,
      webSearch: 'auto',
      includeVeniceSystemPrompt: false,
      mcpServers: [],
    }
    saveDefaults(stored, storage)
    expect(loadDefaults(DEEPSEEK, [DEEPSEEK, GLM], storage)).toEqual(stored)
    expect(loadDefaults(DEEPSEEK, [DEEPSEEK], storage)).toMatchObject({ model: DEEPSEEK, systemPrompt: 'Saved prompt' })

    const { fetchImpl } = fakeFetch({})
    const c = make(fetchImpl, { storage })
    await c.init()
    const id = await c.newChat()
    expect((await store.getChat(id))!.settings).toEqual(stored)
  })

  it('falls back to built-in defaults when storage is empty, broken or throws', () => {
    const fallback = {
      model: DEEPSEEK,
      systemPrompt: '',
      reasoningEffort: null,
      temperature: null,
      webSearch: 'off',
      includeVeniceSystemPrompt: false,
      mcpServers: [],
    }
    expect(loadDefaults(DEEPSEEK, [DEEPSEEK], memoryStorage())).toEqual(fallback)
    const broken = memoryStorage()
    broken.setItem('harness.defaults', '{not json')
    expect(loadDefaults(DEEPSEEK, [DEEPSEEK], broken)).toEqual(fallback)
    const throwing = { getItem: () => { throw new Error('denied') } } as unknown as Storage
    expect(loadDefaults(DEEPSEEK, [DEEPSEEK], throwing)).toEqual(fallback)
    expect(loadDefaults(DEEPSEEK, [DEEPSEEK], null)).toEqual(fallback)
  })
})
