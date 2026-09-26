import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'

// TypeScript resolves this file; Metro selects the platform implementation.
export async function getPrivateMetadata(
  _storage: SignalProtocolLocalStore,
  _key: string,
): Promise<string | null> {
  throw new Error('No private metadata store is available for this platform')
}

export async function setPrivateMetadata(
  _storage: SignalProtocolLocalStore,
  _key: string,
  _value: string,
): Promise<void> {
  throw new Error('No private metadata store is available for this platform')
}

export async function deletePrivateMetadata(
  _storage: SignalProtocolLocalStore,
  _key: string,
): Promise<void> {
  throw new Error('No private metadata store is available for this platform')
}
