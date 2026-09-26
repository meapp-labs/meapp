import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'

type Context = { storage: SignalProtocolLocalStore; userId: string; installId: string }

// Metro selects recovery.web.ts for browser builds.
export async function createRecoveryKey(_context: Context): Promise<string> {
  throw new Error('Recovery keys are currently available in the web app')
}
export async function uploadRecoveryBackup(_context: Context): Promise<void> {
  throw new Error('Recovery keys are currently available in the web app')
}
export function scheduleRecoveryBackup(_context: Context): void {}
export async function recoveryStatus(): Promise<{ available: boolean; updatedAt: number | null }> {
  throw new Error('Recovery keys are currently available in the web app')
}
export async function restoreRecoveryBackup(_accountId: string, _key: string): Promise<void> {
  throw new Error('Recovery keys are currently available in the web app')
}
