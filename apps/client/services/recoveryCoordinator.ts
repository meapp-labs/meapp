import { getFetcher, postFetcher } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import {
  RECOVERY_CHUNK_SIZE,
  RECOVERY_MAX_CHUNKS,
  type RecoveryStatus,
  recoveryBackupSchema,
  recoveryChunkSchema,
  recoveryClaimSchema,
  recoveryCommitSchema,
  recoveryStatusSchema,
} from '@meapp/shared'
import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'
import { getE2EStore } from './e2eStore'
import { decryptRecoverySnapshot, encryptPortableRecovery, phrase } from './recoveryCodec'
import {
  type PortableRecoveryAdapter,
  type PortableRecoverySnapshot,
  claimForSnapshot,
} from './recoveryPortable/contract'

type Context = { storage: SignalProtocolLocalStore; userId: string; installId: string }
const KEY = 'meapp:e2e:recovery-key'
const PROOF = 'meapp:e2e:recovery-proof'
const INSTALL = 'meapp:e2e:install'
const ERROR = 'meapp:e2e:recovery-error'
const TARGET = 'meapp:e2e:restore-target'
type Dependencies = {
  hashProof(proof: string): Promise<string>
  adapterFor(accountId: string, storage: SignalProtocolLocalStore): Promise<PortableRecoveryAdapter>
  logicalPayload(
    payload: Awaited<ReturnType<typeof decryptRecoverySnapshot>>,
    accountId: string,
  ): Promise<PortableRecoverySnapshot>
  lock<T>(accountId: string, work: () => Promise<T>): Promise<T>
}

export function createRecoveryService(dependencies: Dependencies) {
  const flights = new Map<string, Promise<unknown>>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  async function serial<T>(accountId: string, work: () => Promise<T>): Promise<T> {
    const previous = flights.get(accountId) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(() => dependencies.lock(accountId, work))
    flights.set(accountId, pending)
    try {
      return await pending
    } finally {
      if (flights.get(accountId) === pending) flights.delete(accountId)
    }
  }
  async function performBackup(context: Context): Promise<void> {
    try {
      const key = await context.storage.getMetadata(KEY)
      const proof = await context.storage.getMetadata(PROOF)
      if (!key || !proof) throw new Error('Set up a recovery key first')
      const adapter = await dependencies.adapterFor(context.userId, context.storage)
      const snapshot = await adapter.exportSnapshot({
        accountId: context.userId,
        installId: context.installId,
        deviceId: Number(await context.storage.getMetadata('meapp:e2e:device-id')),
        proof,
        createdAt: Date.now(),
      })
      const encrypted = await encryptPortableRecovery(snapshot, key)
      const total = Math.ceil(encrypted.ciphertext.length / RECOVERY_CHUNK_SIZE)
      if (total > RECOVERY_MAX_CHUNKS)
        throw new Error('Recovery backup exceeds the 50 MB encrypted upload limit')
      const uploadId = uuid()
      const proofHash = await dependencies.hashProof(proof)
      for (let index = 0; index < total; index++)
        await postFetcher(
          'e2e/recovery/backup/chunk',
          recoveryChunkSchema.parse({
            installId: context.installId,
            uploadId,
            proofHash,
            iv: encrypted.iv,
            index,
            total,
            chunk: encrypted.ciphertext.slice(
              index * RECOVERY_CHUNK_SIZE,
              (index + 1) * RECOVERY_CHUNK_SIZE,
            ),
          }),
        )
      await postFetcher('e2e/recovery/backup/commit', recoveryCommitSchema.parse({ uploadId }))
      await context.storage.setMetadata(ERROR, '')
    } catch (error) {
      await context.storage.setMetadata(
        ERROR,
        error instanceof Error ? error.message : 'Backup upload failed',
      )
      throw error
    }
  }
  function uploadRecoveryBackup(context: Context): Promise<void> {
    return serial(context.userId, () => performBackup(context))
  }
  function scheduleRecoveryBackup(context: Context): void {
    const previous = timers.get(context.userId)
    if (previous) clearTimeout(previous)
    timers.set(
      context.userId,
      setTimeout(() => {
        timers.delete(context.userId)
        void context.storage
          .getMetadata(KEY)
          .then(async (key) => {
            if (key) await uploadRecoveryBackup(context)
          })
          .catch(() => undefined)
      }, 1500),
    )
  }
  function createRecoveryKey(context: Context): Promise<string> {
    return serial(context.userId, async () => {
      // CAS-created secrets survive an interruption between the two writes.
      if (!(await context.storage.getMetadata(PROOF)))
        await context.storage.compareAndSetMetadata(PROOF, null, phrase())
      if (!(await context.storage.getMetadata(KEY)))
        await context.storage.compareAndSetMetadata(KEY, null, phrase())
      const key = await context.storage.getMetadata(KEY)
      if (!key) throw new Error('Could not persist recovery key')
      await performBackup(context)
      return key
    })
  }
  async function recoveryStatus(): Promise<RecoveryStatus> {
    const status = recoveryStatusSchema.parse(await getFetcher('e2e/recovery/status'))
    const me = await getFetcher<{ id: string }>('me')
    const storage = await getE2EStore(me.id)
    return {
      ...status,
      lastError: await storage.getMetadata(ERROR),
      canUpdate:
        !status.ownerInstallId || status.ownerInstallId === (await storage.getMetadata(INSTALL)),
    }
  }
  function restoreRecoveryBackup(accountId: string, keyText: string): Promise<void> {
    return serial(accountId, async () => {
      const encrypted = recoveryBackupSchema.parse(await getFetcher('e2e/recovery/backup'))
      const key = keyText.trim()
      const snapshot = await dependencies.logicalPayload(
        await decryptRecoverySnapshot(accountId, key, encrypted),
        accountId,
      )
      const storage = await getE2EStore(accountId)
      const adapter = await dependencies.adapterFor(accountId, storage)
      const pending = await adapter.readPendingClaim(accountId)
      const target = pending?.newInstallId ?? (await storage.getMetadata(TARGET)) ?? uuid()
      const claim = claimForSnapshot(snapshot, target)
      if (pending) {
        if (pending.oldInstallId !== claim.oldInstallId || pending.proof !== claim.proof)
          throw new Error('Another recovery is pending on this device')
      } else {
        await storage.setMetadata(TARGET, target)
        await adapter.importSnapshot(snapshot, claim)
      }
      await postFetcher(
        'e2e/recovery/claim',
        recoveryClaimSchema.parse({
          oldInstallId: claim.oldInstallId,
          newInstallId: claim.newInstallId,
          proof: claim.proof,
        }),
      )
      await storage.setMetadata(KEY, key)
      await adapter.completePendingClaim(claim)
      await storage.deleteMetadata(TARGET)
      await performBackup({ storage, userId: accountId, installId: claim.newInstallId }).catch(
        () => undefined,
      )
    })
  }
  return {
    createRecoveryKey,
    uploadRecoveryBackup,
    scheduleRecoveryBackup,
    recoveryStatus,
    restoreRecoveryBackup,
  }
}
