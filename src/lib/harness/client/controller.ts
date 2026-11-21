import type { ModelInfo } from '../catalog'
import { DEFAULT_MODELS } from '../config'
import type { LlmMessage } from '../llm/types'
import { readHarnessStream, type HarnessEvent } from '../protocol'
import type { ChatRequest } from '../schemas'
import { selectCompactionRange, shouldCompact } from '../session/compaction'
import type {
  AssistantMessageEvent,
  AssistantStep,
  Chat,
  ChatSettings,
  SessionEvent,
  StoredAttachment,
  UserMessageEvent,
} from '../session/format'
import { projectForModel, type Projection } from '../session/projection'
import type { SessionStore } from '../session/store'
import { classifyFile, fallbackTitle, readFileAsDataUrl } from './files'

/**
 * The browser half of a turn: it owns the session log, projects it for the
 * model, streams `/api/chat` into an assistant event, persists as it goes,
 * and keeps chat titles, totals and compaction up to date. Framework-free so
 * it can be tested without React; `use-chat.ts` wraps it in hooks.
 */
export interface ControllerState {
  ready: boolean
  chats: Chat[]
  activeChatId: string | null
  events: SessionEvent[]
  attachments: Map<string, StoredAttachment>
  /** Attachments the last projection left out of the model's context. */
  evictedIds: string[]
  streaming: boolean
  compacting: boolean
  models: ModelInfo[]
  defaultModel: string
  compactAtTokens: number
  balanceUsd: number | null
  notice: string | null
}

export interface ChatController {
  getState(): ControllerState
  subscribe(fn: () => void): () => void
  init(): Promise<void>
  newChat(settings?: Partial<ChatSettings>): Promise<string>
  openChat(id: string): Promise<void>
  renameChat(id: string, title: string): Promise<void>
  deleteChat(id: string): Promise<void>
  updateSettings(id: string, patch: Partial<ChatSettings>): Promise<void>
  /** Resolves false when the message was refused (nothing written), true once it was accepted and its turn ran. */
  send(text: string, files: File[]): Promise<boolean>
  stop(): void
  regenerate(): Promise<void>
  editLastUserMessage(text: string): Promise<void>
  compactNow(): Promise<void>
  dismissNotice(): void
}

export interface ControllerDeps {
  store: SessionStore
  fetchImpl?: typeof fetch
  now?: () => number
  newId?: () => string
  flushMs?: number
  readFile?: (f: File) => Promise<string>
  /** Where default settings are kept; null disables it. Defaults to localStorage when available. */
  storage?: Storage | null
}

const DEFAULTS_KEY = 'harness.defaults'
const OVER_BUDGET = 'This message is over the 4 MB limit per request. Remove an attachment or shorten it.'
const COMPACT_FAILED = 'Couldn’t summarise older messages; sending the full history.'

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function builtInDefaults(defaultModel: string): ChatSettings {
  return {
    model: defaultModel,
    systemPrompt: '',
    reasoningEffort: null,
    temperature: null,
    webSearch: 'off',
    includeVeniceSystemPrompt: false,
    mcpServers: [],
  }
}

/** Settings for a new chat: the saved defaults, or built-in ones. Never throws. */
export function loadDefaults(defaultModel: string, models: string[], storage: Storage | null = browserStorage()): ChatSettings {
  const base = builtInDefaults(defaultModel)
  let saved: Partial<ChatSettings> | null = null
  try {
    const raw = storage?.getItem(DEFAULTS_KEY)
    saved = raw ? (JSON.parse(raw) as Partial<ChatSettings>) : null
  } catch {
    saved = null
  }
  if (!saved || typeof saved !== 'object') return base
  const merged: ChatSettings = { ...base, ...saved }
  if (typeof merged.model !== 'string' || (models.length && !models.includes(merged.model))) {
    merged.model = defaultModel
  }
  return merged
}

export function saveDefaults(s: ChatSettings, storage: Storage | null = browserStorage()): void {
  try {
    storage?.setItem(DEFAULTS_KEY, JSON.stringify(s))
  } catch {
    // Private mode or storage full: defaults just aren't remembered.
  }
}

function emptyStep(): AssistantStep {
  return { reasoning: '', text: '', citations: [], toolCalls: [] }
}

/** One stream event applied to an assistant event, returning a new object (state stays immutable). */
function applyEvent(draft: AssistantMessageEvent, e: HarnessEvent): AssistantMessageEvent {
  const steps = draft.steps.length ? [...draft.steps] : [emptyStep()]
  const last = { ...steps[steps.length - 1] }
  const withLast = () => {
    steps[steps.length - 1] = last
    return { ...draft, steps }
  }
  switch (e.type) {
    case 'step-start':
      return draft.steps.length === 0 ? { ...draft, steps: [emptyStep()] } : { ...draft, steps: [...draft.steps, emptyStep()] }
    case 'reasoning-delta':
      last.reasoning += e.text
      return withLast()
    case 'text-delta':
      last.text += e.text
      return withLast()
    case 'citations':
      last.citations = [...last.citations, ...e.citations]
      return withLast()
    case 'tool-call':
      last.toolCalls = [...last.toolCalls, { id: e.id, name: e.name, args: e.args, result: null }]
      return withLast()
    case 'tool-result':
      last.toolCalls = last.toolCalls.map((c) => (c.id === e.id ? { ...c, result: e.result } : c))
      return withLast()
    case 'usage':
      return { ...draft, usage: e.usage, costUsd: e.costUsd }
    case 'done':
      return {
        ...draft,
        status: e.finishReason === 'aborted' ? 'interrupted' : 'complete',
        finishReason: e.finishReason,
      }
    case 'error':
      return { ...draft, status: 'error', error: { message: e.message, status: e.status } }
    default:
      return draft
  }
}

function finalText(a: AssistantMessageEvent): string {
  return [...a.steps].reverse().find((s) => s.text)?.text ?? ''
}

/** A text-only rendering of events for the compaction route. */
function compactionMessages(events: SessionEvent[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const e of events) {
    if (e.type === 'compaction') {
      out.push({ role: 'user', content: `[Summary of earlier conversation]\n${e.summary}` })
    } else if (e.type === 'user-message') {
      const names = e.attachments.map((a) => a.name)
      const content = names.length ? `${e.text}\n[Attached: ${names.join(', ')}]`.trim() : e.text
      if (content) out.push({ role: 'user', content })
    } else {
      const text = e.steps.map((s) => s.text).filter(Boolean).join('\n\n')
      if (text) out.push({ role: 'assistant', content: text })
    }
  }
  return out
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : fallback
}

export function createChatController(deps: ControllerDeps): ChatController {
  const { store } = deps
  const fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const flushMs = deps.flushMs ?? 500
  const readFile = deps.readFile ?? readFileAsDataUrl
  const storage = deps.storage === undefined ? browserStorage() : deps.storage

  let state: ControllerState = {
    ready: false,
    chats: [],
    activeChatId: null,
    events: [],
    attachments: new Map(),
    evictedIds: [],
    streaming: false,
    compacting: false,
    models: [],
    defaultModel: DEFAULT_MODELS[0],
    compactAtTokens: 150_000,
    balanceUsd: null,
    notice: null,
  }
  const listeners = new Set<() => void>()
  let abort: AbortController | null = null
  let turn: Promise<unknown> | null = null
  let lastTs = 0

  function set(patch: Partial<ControllerState>) {
    state = { ...state, ...patch }
    for (const fn of listeners) fn()
  }

  /** Timestamps strictly increase, so events never tie in the log's order. */
  function stamp(): number {
    lastTs = Math.max(now(), lastTs + 1)
    return lastTs
  }

  const chatById = (id: string) => state.chats.find((c) => c.id === id)
  const modelInfo = (id: string) => state.models.find((m) => m.id === id)

  async function saveChat(chat: Chat) {
    await store.putChat(chat)
    set({ chats: await store.listChats() })
  }

  function replaceEvent(event: SessionEvent) {
    if (state.activeChatId !== event.chatId) return
    const exists = state.events.some((e) => e.id === event.id)
    set({ events: exists ? state.events.map((e) => (e.id === event.id ? event : e)) : [...state.events, event] })
  }

  function project(chat: Chat, events: SessionEvent[], attachments: Map<string, StoredAttachment>): Projection {
    return projectForModel(events, attachments, {
      systemPrompt: chat.settings.systemPrompt,
      supportsVision: modelInfo(chat.settings.model)?.supportsVision ?? true,
    })
  }

  async function compact(chatId: string, events: SessionEvent[], silent: boolean): Promise<boolean> {
    const range = selectCompactionRange(events)
    if (!range) {
      if (!silent) set({ notice: 'There isn’t enough history to summarise yet.' })
      return false
    }
    set({ compacting: true })
    try {
      const res = await fetchImpl('/api/compact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: compactionMessages(range.toSummarize) }),
      })
      const body = (await res.json().catch(() => null)) as { summary?: unknown } | null
      if (!res.ok || typeof body?.summary !== 'string') {
        set({ notice: COMPACT_FAILED })
        return false
      }
      const event: SessionEvent = {
        id: newId(),
        chatId,
        ts: stamp(),
        v: 1,
        type: 'compaction',
        summary: body.summary,
        coversThroughEventId: range.throughEventId,
      }
      await store.putEvent(event)
      replaceEvent(event)
      return true
    } catch {
      set({ notice: COMPACT_FAILED })
      return false
    } finally {
      set({ compacting: false })
    }
  }

  /**
   * The projection to send, compacting first when the history is too big.
   * `pending` is a message not yet written, so a refusal leaves nothing behind.
   */
  async function prepare(
    chat: Chat,
    pending?: { event: UserMessageEvent; attachments: StoredAttachment[] },
  ): Promise<Projection | null> {
    const withPending = () => ({
      events: pending ? [...state.events, pending.event] : state.events,
      attachments: pending
        ? new Map([...state.attachments, ...pending.attachments.map((a) => [a.id, a] as const)])
        : state.attachments,
    })
    // A message that is over budget on its own can't be helped by evicting or
    // summarising older history: refuse it before spending a compaction call.
    if (pending) {
      const alone = projectForModel(
        [pending.event],
        new Map(pending.attachments.map((a) => [a.id, a] as const)),
        { systemPrompt: chat.settings.systemPrompt, supportsVision: modelInfo(chat.settings.model)?.supportsVision ?? true },
      )
      if (alone.overBudget) {
        set({ notice: OVER_BUDGET })
        return null
      }
    }
    let { events, attachments } = withPending()
    let projection = project(chat, events, attachments)
    if (shouldCompact(projection, state.compactAtTokens)) {
      if (await compact(chat.id, events, true)) {
        ;({ events, attachments } = withPending())
        projection = project(chat, events, attachments)
      }
    }
    if (projection.overBudget) {
      set({ notice: OVER_BUDGET })
      return null
    }
    return projection
  }

  async function streamTurn(chatId: string, projection: Projection) {
    const chat = chatById(chatId)!
    let draft: AssistantMessageEvent = {
      id: newId(),
      chatId,
      ts: stamp(),
      v: 1,
      type: 'assistant-message',
      model: chat.settings.model,
      steps: [],
      status: 'streaming',
      finishReason: null,
      error: null,
      usage: null,
      costUsd: null,
    }
    await store.putEvent(draft)
    replaceEvent(draft)
    set({ evictedIds: projection.evictedAttachmentIds })

    const s = chat.settings
    const request: ChatRequest = {
      model: s.model,
      messages: projection.messages as LlmMessage[],
      settings: {
        ...(s.reasoningEffort ? { reasoningEffort: s.reasoningEffort } : {}),
        ...(s.temperature !== null ? { temperature: s.temperature } : {}),
        webSearch: s.webSearch,
        includeVeniceSystemPrompt: s.includeVeniceSystemPrompt,
        mcpServers: s.mcpServers,
      },
    }

    const ctrl = new AbortController()
    abort = ctrl
    let lastFlush = now()
    const update = (next: AssistantMessageEvent) => {
      draft = next
      replaceEvent(draft)
    }
    const fail = (message: string, status: number) =>
      update({ ...draft, status: 'error', error: { message, status } })

    try {
      const res = await fetchImpl('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        fail(await errorMessage(res, `The request failed (${res.status}).`), res.status)
      } else {
        for await (const e of readHarnessStream(res)) {
          if (e.type === 'meta') {
            set({ balanceUsd: e.balanceUsd })
            continue
          }
          update(applyEvent(draft, e))
          if (now() - lastFlush >= flushMs) {
            lastFlush = now()
            await store.putEvent(draft)
          }
          if (e.type === 'done' || e.type === 'error') break
        }
        if (draft.status === 'streaming') {
          if (ctrl.signal.aborted) update({ ...draft, status: 'interrupted', finishReason: 'aborted' })
          else fail('The connection was lost before the reply finished.', 0)
        }
      }
    } catch {
      if (ctrl.signal.aborted) update({ ...draft, status: 'interrupted', finishReason: 'aborted' })
      else fail('Couldn’t reach the server. Check your connection and try again.', 0)
    } finally {
      abort = null
    }
    // The chat may have been deleted while it streamed: don't bring it back.
    const latest = await store.getChat(chatId)
    if (!latest) return
    await store.putEvent(draft)

    const updated: Chat = {
      ...latest,
      updatedAt: now(),
      totals: draft.usage
        ? {
            inputTokens: latest.totals.inputTokens + draft.usage.inputTokens,
            outputTokens: latest.totals.outputTokens + draft.usage.outputTokens,
            costUsd: latest.totals.costUsd + (draft.costUsd ?? 0),
          }
        : latest.totals,
    }
    await saveChat(updated)
    if (draft.status === 'complete' && updated.titleSource === null) await setTitle(updated, draft)
  }

  async function setTitle(chat: Chat, reply: AssistantMessageEvent) {
    const events = await store.listEvents(chat.id)
    const firstUser = events.find((e): e is UserMessageEvent => e.type === 'user-message')
    const userText = firstUser?.text ?? ''
    let title: string | null = null
    try {
      const res = await fetchImpl('/api/title', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: userText || '(attachment)', assistantText: finalText(reply) }),
      })
      const body = (await res.json().catch(() => null)) as { title?: unknown } | null
      if (res.ok && typeof body?.title === 'string' && body.title.trim()) title = body.title.trim()
    } catch {
      title = null
    }
    const latest = (await store.getChat(chat.id)) ?? chat
    if (latest.titleSource !== null) return
    await saveChat({
      ...latest,
      title: title ?? fallbackTitle(userText),
      titleSource: title ? 'auto' : 'fallback',
    })
  }

  /** Run a turn on the current log, holding the streaming flag throughout. */
  async function withTurn<T>(fn: () => Promise<T>, busy: T): Promise<T> {
    if (state.streaming) return busy
    set({ streaming: true })
    const run = fn()
    turn = run.catch(() => {})
    try {
      return await run
    } finally {
      turn = null
      set({ streaming: false })
    }
  }

  async function loadChat(id: string) {
    const events = await store.listEvents(id)
    const fixed: SessionEvent[] = []
    for (const e of events) {
      // Left 'streaming' by a tab that went away mid-reply.
      if (e.type === 'assistant-message' && e.status === 'streaming') {
        const interrupted: AssistantMessageEvent = { ...e, status: 'interrupted', finishReason: 'aborted' }
        await store.putEvent(interrupted)
        fixed.push(interrupted)
      } else {
        fixed.push(e)
      }
    }
    set({ activeChatId: id, events: fixed, attachments: await store.getAttachments(id), evictedIds: [] })
  }

  const controller: ChatController = {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    async init() {
      try {
        const res = await fetchImpl('/api/models')
        if (res.ok) {
          const body = (await res.json()) as { models: ModelInfo[]; defaultModel: string; compactAtTokens: number }
          set({ models: body.models, defaultModel: body.defaultModel, compactAtTokens: body.compactAtTokens })
        } else {
          set({ notice: await errorMessage(res, 'Couldn’t load the model list.') })
        }
      } catch {
        set({ notice: 'Couldn’t reach the server. Check your connection and try again.' })
      }
      const chats = await store.listChats()
      set({ chats })
      if (chats[0]) await loadChat(chats[0].id)
      set({ ready: true })
    },

    async newChat(settings = {}) {
      const t = now()
      const chat: Chat = {
        id: newId(),
        title: 'New chat',
        titleSource: null,
        createdAt: t,
        updatedAt: t,
        settings: {
          ...loadDefaults(
            state.defaultModel,
            state.models.map((m) => m.id),
            storage,
          ),
          ...settings,
        },
        totals: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      }
      await saveChat(chat)
      set({ activeChatId: chat.id, events: [], attachments: new Map(), evictedIds: [] })
      return chat.id
    },

    async openChat(id) {
      if (state.streaming) return
      await loadChat(id)
    },

    async renameChat(id, title) {
      const chat = await store.getChat(id)
      const clean = title.replace(/\s+/g, ' ').trim()
      if (!chat || !clean) return
      await saveChat({ ...chat, title: clean.slice(0, 80), titleSource: 'user' })
    },

    async deleteChat(id) {
      if (state.streaming && state.activeChatId === id) {
        controller.stop()
        // Let the turn finish writing before deleting, so nothing is written after.
        await turn
      }
      await store.deleteChat(id)
      const chats = await store.listChats()
      set({ chats })
      if (state.activeChatId === id) {
        if (chats[0]) await loadChat(chats[0].id)
        else set({ activeChatId: null, events: [], attachments: new Map(), evictedIds: [] })
      }
    },

    async updateSettings(id, patch) {
      const chat = await store.getChat(id)
      if (!chat) return
      await saveChat({ ...chat, settings: { ...chat.settings, ...patch } })
    },

    async send(text, files) {
      const clean = text.trim()
      if (state.streaming || (!clean && files.length === 0)) return false
      return withTurn(async () => {
        const chatId = state.activeChatId ?? (await controller.newChat())
        const chat = chatById(chatId)!
        const vision = modelInfo(chat.settings.model)?.supportsVision ?? true
        for (const f of files) {
          const check = classifyFile(f, vision)
          if (!check.ok) {
            set({ notice: check.error })
            return false
          }
        }
        let stored: StoredAttachment[]
        try {
          stored = await Promise.all(
            files.map(async (f) => ({
              id: newId(),
              name: f.name,
              mime: f.type || 'application/octet-stream',
              size: f.size,
              kind: (classifyFile(f, vision) as { kind: 'image' | 'file' }).kind,
              dataUrl: await readFile(f),
            })),
          )
        } catch {
          set({ notice: 'Couldn’t read that file.' })
          return false
        }
        const event: UserMessageEvent = {
          id: newId(),
          chatId,
          ts: stamp(),
          v: 1,
          type: 'user-message',
          text: clean,
          attachments: stored.map(({ dataUrl: _d, ...ref }) => {
            void _d
            return ref
          }),
        }
        const projection = await prepare(chat, { event, attachments: stored })
        if (!projection) return false
        for (const a of stored) await store.putAttachment(chatId, a)
        event.ts = stamp() // after any compaction event written by prepare()
        await store.putEvent(event)
        set({ attachments: new Map([...state.attachments, ...stored.map((a) => [a.id, a] as const)]) })
        replaceEvent(event)
        await streamTurn(chatId, projection)
        return true
      }, false)
    },

    stop() {
      abort?.abort()
    },

    async regenerate() {
      const chatId = state.activeChatId
      if (!chatId) return
      await withTurn(async () => {
        const idx = state.events.findLastIndex((e) => e.type === 'assistant-message')
        if (idx > 0) {
          await store.deleteEventsAfter(chatId, state.events[idx - 1].id)
          set({ events: state.events.slice(0, idx) })
        }
        const projection = await prepare(chatById(chatId)!)
        if (projection) await streamTurn(chatId, projection)
      }, undefined)
    },

    async editLastUserMessage(text) {
      const chatId = state.activeChatId
      const clean = text.trim()
      if (!chatId || !clean) return
      await withTurn(async () => {
        const idx = state.events.findLastIndex((e) => e.type === 'user-message')
        if (idx === -1) return
        const edited = { ...(state.events[idx] as UserMessageEvent), text: clean }
        await store.putEvent(edited)
        await store.deleteEventsAfter(chatId, edited.id)
        set({ events: [...state.events.slice(0, idx), edited] })
        const projection = await prepare(chatById(chatId)!)
        if (projection) await streamTurn(chatId, projection)
      }, undefined)
    },

    async compactNow() {
      const chatId = state.activeChatId
      if (!chatId || state.streaming || state.compacting) return
      await compact(chatId, state.events, false)
    },

    dismissNotice() {
      if (state.notice !== null) set({ notice: null })
    },
  }
  return controller
}
