import * as ExpoCrypto from 'expo-crypto'
import { getNativeRecoveryDriver } from './e2eStore.native'
import { createRecoveryService } from './recoveryCoordinator'
import { PortableRecoveryError } from './recoveryPortable/contract'
import { NativeRecoveryAdapter } from './recoveryPortable/native'

const service = createRecoveryService({
  hashProof: async (proof) =>
    ExpoCrypto.digestStringAsync(ExpoCrypto.CryptoDigestAlgorithm.SHA256, proof),
  adapterFor: async (accountId) =>
    new NativeRecoveryAdapter(accountId, await getNativeRecoveryDriver(accountId)),
  logicalPayload: async (payload) => {
    if ('stores' in payload)
      throw new PortableRecoveryError(
        'INCOMPATIBLE_FORMAT',
        'Restore this older backup in the updated web app first, then update it for native recovery',
      )
    return payload
  },
  lock: async (_accountId, work) => work(),
})
export const {
  createRecoveryKey,
  uploadRecoveryBackup,
  scheduleRecoveryBackup,
  recoveryStatus,
  restoreRecoveryBackup,
} = service
