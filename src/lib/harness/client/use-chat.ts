'use client'

import { useSyncExternalStore } from 'react'
import { createIndexedDbStore } from '../session/indexeddb'
import { createMemoryStore } from '../session/store'
import { createChatController, type ChatController, type ControllerState } from './controller'

let singleton: ChatController | null = null

/** One controller per tab, over IndexedDB (or memory, where IndexedDB is unavailable). */
export function getChatController(): ChatController {
  if (!singleton) {
    const store = typeof indexedDB === 'undefined' ? createMemoryStore() : createIndexedDbStore()
    singleton = createChatController({ store })
  }
  return singleton
}

export function useChatController(): ChatController {
  return getChatController()
}

/**
 * A slice of controller state. `select` must return something already in the
 * state (a field, or a value derived from fields that is a primitive), not a
 * new object per call, or React re-renders forever.
 */
export function useControllerState<T>(select: (s: ControllerState) => T): T {
  const c = getChatController()
  return useSyncExternalStore(
    c.subscribe,
    () => select(c.getState()),
    () => select(c.getState()),
  )
}
