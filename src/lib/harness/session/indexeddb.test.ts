import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createIndexedDbStore } from './indexeddb'
import { chat, runStoreContract } from './store.contract'

runStoreContract('IndexedDB store', () =>
  createIndexedDbStore({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange, dbName: crypto.randomUUID() }),
)

describe('IndexedDB store', () => {
  it('persists across store instances on the same database', async () => {
    const factory = new IDBFactory()
    await createIndexedDbStore({ indexedDB: factory, keyRange: IDBKeyRange, dbName: 'shared' }).putChat(chat('kept', 1))
    expect(await createIndexedDbStore({ indexedDB: factory, keyRange: IDBKeyRange, dbName: 'shared' }).getChat('kept')).toEqual(chat('kept', 1))
  })
})
