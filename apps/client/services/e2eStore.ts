import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'

// TypeScript resolves this file; Metro selects e2eStore.web.ts or
// e2eStore.native.ts for the actual platform implementation.
export async function getE2EStore(_accountId: string): Promise<SignalProtocolLocalStore> {
  throw new Error('No encrypted local store is available for this platform')
}

export async function resetE2EStore(_accountId: string): Promise<void> {
  throw new Error('No encrypted local store is available for this platform')
}
