import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'
import {
  IndexedDbSignalProtocolStore,
  indexedDbStore,
} from '@open-e2ee/signal-protocol-sdk/local/store/web'

const ACCOUNT_KEY = 'meapp:e2e:account'
const stores = new Map<string, Promise<SignalProtocolLocalStore>>()
let legacyStorePromise: ReturnType<typeof indexedDbStore> | null = null

export const getE2EStore = (accountId: string): Promise<SignalProtocolLocalStore> => {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    throw new Error('End-to-end encryption requires a secure browser context')
  }
  let store = stores.get(accountId)
  if (!store) {
    store = (async () => {
      // Keep keys made before account-scoped storage accessible to their owner.
      legacyStorePromise ??= indexedDbStore()
      const legacyStore = await legacyStorePromise
      if ((await legacyStore.getMetadata(ACCOUNT_KEY)) === accountId) return legacyStore

      const accountStore = new IndexedDbSignalProtocolStore()
      // The SDK currently fixes dbName in its constructor and types it private.
      // Set it before initialize so each account has an independent key database.
      const dbName = `meapp-e2e-${accountId}`
      if (
        !Reflect.set(accountStore, 'dbName', dbName) ||
        Reflect.get(accountStore, 'dbName') !== dbName
      ) {
        throw new Error('Account-scoped encryption storage is unavailable')
      }
      await accountStore.initialize()
      return accountStore
    })().catch((error: unknown) => {
      stores.delete(accountId)
      throw error
    })
    stores.set(accountId, store)
  }
  return store
}

export async function resetE2EStore(accountId: string): Promise<void> {
  const existing = stores.get(accountId)
  stores.delete(accountId)
  if (existing) ((await existing) as IndexedDbSignalProtocolStore).close()
}
