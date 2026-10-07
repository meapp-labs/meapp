import { createRecoveryService } from './recoveryCoordinator'
import { BrowserRecoveryAdapter, convertLegacyBrowserSnapshot } from './recoveryPortable/browser'

const service = createRecoveryService({
  hashProof: async (proof) => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof))
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  },
  adapterFor: async (accountId, storage) => new BrowserRecoveryAdapter(accountId, storage),
  logicalPayload: async (payload, accountId) =>
    'stores' in payload ? convertLegacyBrowserSnapshot(payload, accountId, Date.now()) : payload,
  lock: async (accountId, work) => {
    if (!navigator.locks) throw new Error('Recovery requires a browser with Web Locks support')
    return navigator.locks.request(`meapp:recovery:${accountId}`, work)
  },
})
export const {
  createRecoveryKey,
  uploadRecoveryBackup,
  scheduleRecoveryBackup,
  recoveryStatus,
  restoreRecoveryBackup,
} = service
