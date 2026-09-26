import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'

// The native SDK store lives in the app's SQLCipher database.
export const getPrivateMetadata = (storage: SignalProtocolLocalStore, key: string) =>
  storage.getMetadata(key)

export const setPrivateMetadata = (storage: SignalProtocolLocalStore, key: string, value: string) =>
  storage.setMetadata(key, value)

export const deletePrivateMetadata = (storage: SignalProtocolLocalStore, key: string) =>
  storage.deleteMetadata(key)
