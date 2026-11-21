import type { Chat, SessionEvent, StoredAttachment } from './format'

/**
 * Where chats live (DeepSeek Harness's `session-persistence`). The browser's
 * IndexedDB in v1; a database-backed store later implements the same
 * interface and nothing above it changes.
 */
export interface SessionStore {
  /** Newest `updatedAt` first. */
  listChats(): Promise<Chat[]>
  getChat(id: string): Promise<Chat | null>
  putChat(chat: Chat): Promise<void>
  /** Also deletes the chat's events and attachments. */
  deleteChat(id: string): Promise<void>
  /** Ascending `ts`. */
  listEvents(chatId: string): Promise<SessionEvent[]>
  /** Insert, or replace the event with the same id. */
  putEvent(event: SessionEvent): Promise<void>
  /** Removes the chat's events strictly after `eventId`. */
  deleteEventsAfter(chatId: string, eventId: string): Promise<void>
  putAttachment(chatId: string, attachment: StoredAttachment): Promise<void>
  getAttachments(chatId: string): Promise<Map<string, StoredAttachment>>
}

export function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** In-memory store, for tests and as a fallback when IndexedDB is unavailable. */
export function createMemoryStore(): SessionStore {
  const chats = new Map<string, Chat>()
  const events = new Map<string, SessionEvent>()
  const attachments = new Map<string, { chatId: string; a: StoredAttachment }>()
  const clone = <T>(v: T): T => structuredClone(v)

  const eventsOf = (chatId: string) =>
    [...events.values()].filter((e) => e.chatId === chatId).sort((a, b) => a.ts - b.ts)

  return {
    async listChats() {
      return sortChats([...chats.values()]).map(clone)
    },
    async getChat(id) {
      const c = chats.get(id)
      return c ? clone(c) : null
    },
    async putChat(chat) {
      chats.set(chat.id, clone(chat))
    },
    async deleteChat(id) {
      chats.delete(id)
      for (const e of eventsOf(id)) events.delete(e.id)
      for (const [key, v] of attachments) if (v.chatId === id) attachments.delete(key)
    },
    async listEvents(chatId) {
      return eventsOf(chatId).map(clone)
    },
    async putEvent(event) {
      events.set(event.id, clone(event))
    },
    async deleteEventsAfter(chatId, eventId) {
      const list = eventsOf(chatId)
      const i = list.findIndex((e) => e.id === eventId)
      if (i === -1) return
      for (const e of list.slice(i + 1)) events.delete(e.id)
    },
    async putAttachment(chatId, a) {
      attachments.set(a.id, { chatId, a: clone(a) })
    },
    async getAttachments(chatId) {
      const out = new Map<string, StoredAttachment>()
      for (const v of attachments.values()) if (v.chatId === chatId) out.set(v.a.id, clone(v.a))
      return out
    },
  }
}
