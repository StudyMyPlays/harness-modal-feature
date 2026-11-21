import { beforeEach, describe, expect, it } from 'vitest'
import { attachment, makeEvents } from '@/test/sessions'
import type { Chat } from './format'
import type { SessionStore } from './store'

export function chat(id: string, updatedAt: number): Chat {
  return {
    id,
    title: id,
    titleSource: null,
    createdAt: 0,
    updatedAt,
    settings: {
      model: 'm',
      systemPrompt: '',
      reasoningEffort: null,
      temperature: null,
      webSearch: 'off',
      includeVeniceSystemPrompt: false,
      mcpServers: [],
    },
    totals: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  }
}

/** Behaviour every SessionStore must have, run against each implementation. */
export function runStoreContract(name: string, make: () => SessionStore) {
  describe(`${name} (SessionStore contract)`, () => {
    let store: SessionStore
    beforeEach(() => {
      store = make()
    })

    it('put/get/list chats ordered by updatedAt desc', async () => {
      await store.putChat(chat('a', 1))
      await store.putChat(chat('b', 3))
      await store.putChat(chat('c', 2))
      expect((await store.listChats()).map((c) => c.id)).toEqual(['b', 'c', 'a'])
      expect(await store.getChat('c')).toEqual(chat('c', 2))
      expect(await store.getChat('zzz')).toBeNull()
      await store.putChat({ ...chat('a', 9), title: 'renamed' })
      expect((await store.listChats())[0]).toMatchObject({ id: 'a', title: 'renamed' })
    })

    it('putEvent replaces by id', async () => {
      const e = makeEvents('x')
      const a = e.assistant('partial', { status: 'streaming' })
      await store.putEvent(a)
      await store.putEvent({ ...a, status: 'complete' })
      const events = await store.listEvents('x')
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ status: 'complete' })
    })

    it('listEvents ordered by ts and scoped to the chat', async () => {
      const e = makeEvents('x')
      const first = e.user('1')
      const second = e.assistant('2')
      const other = makeEvents('y').user('other')
      await store.putEvent(second)
      await store.putEvent(other)
      await store.putEvent(first)
      expect((await store.listEvents('x')).map((ev) => ev.id)).toEqual([first.id, second.id])
    })

    it('deleteEventsAfter removes later events only', async () => {
      const e = makeEvents('x')
      const list = [e.user('1'), e.assistant('2'), e.user('3'), e.assistant('4')]
      for (const ev of list) await store.putEvent(ev)
      const other = makeEvents('y').user('keep')
      await store.putEvent(other)
      await store.deleteEventsAfter('x', list[1].id)
      expect((await store.listEvents('x')).map((ev) => ev.id)).toEqual([list[0].id, list[1].id])
      expect(await store.listEvents('y')).toHaveLength(1)
    })

    it('deleteChat cascades', async () => {
      await store.putChat(chat('x', 1))
      await store.putEvent(makeEvents('x').user('1'))
      await store.putAttachment('x', attachment('att', 'image'))
      await store.putChat(chat('y', 1))
      await store.putEvent(makeEvents('y').user('1'))
      await store.deleteChat('x')
      expect(await store.getChat('x')).toBeNull()
      expect(await store.listEvents('x')).toEqual([])
      expect((await store.getAttachments('x')).size).toBe(0)
      expect(await store.listEvents('y')).toHaveLength(1)
    })

    it('attachments round-trip', async () => {
      const a = attachment('a1', 'image')
      const b = attachment('b1', 'file')
      await store.putAttachment('x', a)
      await store.putAttachment('x', b)
      await store.putAttachment('y', attachment('c1', 'file'))
      const got = await store.getAttachments('x')
      expect([...got.keys()].sort()).toEqual(['a1', 'b1'])
      expect(got.get('a1')).toEqual(a)
    })
  })
}
