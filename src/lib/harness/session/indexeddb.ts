import type { Chat, SessionEvent, StoredAttachment } from './format'
import { sortChats, type SessionStore } from './store'

/**
 * The v1 SessionStore: the browser's IndexedDB, through a small in-repo
 * wrapper. Attachments are their own object store so the chat list never
 * loads megabytes of data URLs.
 */
const VERSION = 1

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export function createIndexedDbStore(
  opts: { dbName?: string; indexedDB?: IDBFactory; keyRange?: typeof IDBKeyRange } = {},
): SessionStore {
  const factory = opts.indexedDB ?? globalThis.indexedDB
  const KeyRange = opts.keyRange ?? globalThis.IDBKeyRange
  const chatRange = (chatId: string) => KeyRange.bound([chatId, -Infinity], [chatId, Infinity])
  const name = opts.dbName ?? 'harness'
  let dbPromise: Promise<IDBDatabase> | null = null

  function db(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = factory.open(name, VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        d.createObjectStore('chats', { keyPath: 'id' })
        d.createObjectStore('events', { keyPath: 'id' }).createIndex('byChat', ['chatId', 'ts'])
        d.createObjectStore('attachments', { keyPath: 'id' }).createIndex('byChat', 'chatId')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        reject(req.error)
      }
    })
    return dbPromise
  }

  async function tx(stores: string[], mode: IDBTransactionMode) {
    return (await db()).transaction(stores, mode)
  }

  return {
    async listChats() {
      const t = await tx(['chats'], 'readonly')
      return sortChats(await promisify(t.objectStore('chats').getAll() as IDBRequest<Chat[]>))
    },
    async getChat(id) {
      const t = await tx(['chats'], 'readonly')
      return ((await promisify(t.objectStore('chats').get(id))) as Chat | undefined) ?? null
    },
    async putChat(chat) {
      const t = await tx(['chats'], 'readwrite')
      t.objectStore('chats').put(chat)
      await done(t)
    },
    async deleteChat(id) {
      const t = await tx(['chats', 'events', 'attachments'], 'readwrite')
      t.objectStore('chats').delete(id)
      const events = t.objectStore('events')
      for (const key of await promisify(events.index('byChat').getAllKeys(chatRange(id)))) events.delete(key)
      const atts = t.objectStore('attachments')
      for (const key of await promisify(atts.index('byChat').getAllKeys(id))) atts.delete(key)
      await done(t)
    },
    async listEvents(chatId) {
      const t = await tx(['events'], 'readonly')
      return (await promisify(t.objectStore('events').index('byChat').getAll(chatRange(chatId)))) as SessionEvent[]
    },
    async putEvent(event) {
      const t = await tx(['events'], 'readwrite')
      t.objectStore('events').put(event)
      await done(t)
    },
    async deleteEventsAfter(chatId, eventId) {
      const t = await tx(['events'], 'readwrite')
      const store = t.objectStore('events')
      const list = (await promisify(store.index('byChat').getAll(chatRange(chatId)))) as SessionEvent[]
      const i = list.findIndex((e) => e.id === eventId)
      if (i !== -1) for (const e of list.slice(i + 1)) store.delete(e.id)
      await done(t)
    },
    async putAttachment(chatId, a) {
      const t = await tx(['attachments'], 'readwrite')
      t.objectStore('attachments').put({ ...a, chatId })
      await done(t)
    },
    async getAttachments(chatId) {
      const t = await tx(['attachments'], 'readonly')
      const rows = (await promisify(t.objectStore('attachments').index('byChat').getAll(chatId))) as Array<
        StoredAttachment & { chatId?: string }
      >
      const out = new Map<string, StoredAttachment>()
      for (const { chatId: _omit, ...a } of rows) {
        void _omit
        out.set(a.id, a)
      }
      return out
    },
  }
}
