import { runStoreContract } from './store.contract'
import { createMemoryStore } from './store'

runStoreContract('memory store', createMemoryStore)
