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
import type { IDBPDatabase } from 'idb'
import {
  type Snapshot,
  decode,
  decryptSnapshot,
  encode,
  encryptSnapshot,
  phrase,
} from './recoveryCodec'

import { getFetcher, postFetcher } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import { getE2EStore, resetE2EStore } from './e2eStore'

const KEY_NAME = 'meapp:e2e:recovery-key'
const PROOF_NAME = 'meapp:e2e:recovery-proof'
const INSTALL_NAME = 'meapp:e2e:install'
const ACCOUNT_NAME = 'meapp:e2e:account'
const RESTORE_ID_PREFIX = 'meapp:e2e:restore-install:'
const PENDING_RESTORE = 'meapp:e2e:restore-pending'
const ERROR_NAME = 'meapp:e2e:recovery-error'

type Context = { storage: SignalProtocolLocalStore; userId: string; installId: string }
// SDK 6.0.0 stores application metadata under this physical IndexedDB prefix.
const metadataKey = (key: string) => `meta:${key}`

function database(storage: SignalProtocolLocalStore): IDBPDatabase {
  const db = Reflect.get(storage, 'db') as IDBPDatabase | null
  if (!db) throw new Error('Encrypted device storage is unavailable')
  return db
}

async function snapshot(context: Context, proof: string): Promise<Snapshot> {
  const db = database(context.storage)
  const names = Array.from(db.objectStoreNames)
  const transaction = db.transaction(names, 'readonly')
  const entries = await Promise.all(
    names.map(async (name) => {
      const store = transaction.objectStore(name)
      const [keys, values] = await Promise.all([store.getAllKeys(), store.getAll()])
      return [
        name,
        // Upload bytes are device-local retry data, not message/key recovery data.
        // Including up to 40 MB here would exceed the recovery API's body cap.
        keys.flatMap((key, index) =>
          name === 'metadata' &&
          [
            metadataKey('meapp:media:uploads:v1'),
            metadataKey(PENDING_RESTORE),
            metadataKey(ERROR_NAME),
          ].includes(String(key))
            ? []
            : [{ key: key as string | number, value: encode(values[index]) }],
        ),
      ] as const
    }),
  )
  await transaction.done
  return {
    version: 1,
    storeVersion: db.version,
    accountId: context.userId,
    installId: context.installId,
    proof,
    stores: Object.fromEntries(entries),
  }
}

async function restore(snapshotData: Snapshot, newInstallId: string): Promise<void> {
  const storage = await getE2EStore(snapshotData.accountId)
  if (await storage.getIdentityKey()) throw new Error('This browser already has encryption keys')
  const db = database(storage)
  const names = Array.from(db.objectStoreNames)
  if (
    (snapshotData.storeVersion !== undefined && snapshotData.storeVersion !== db.version) ||
    // Legacy v1 snapshots were produced only by the SDK's version 6 store.
    (snapshotData.storeVersion === undefined && db.version !== 6) ||
    names.length !== Object.keys(snapshotData.stores).length ||
    names.some((name) => !Array.isArray(snapshotData.stores[name]))
  ) {
    throw new Error('Recovery backup is incompatible with this app version')
  }
  const transaction = db.transaction(names, 'readwrite')
  if (await transaction.objectStore('identity').count()) {
    transaction.abort()
    await transaction.done.catch(() => undefined)
    throw new Error('This browser already has encryption keys')
  }
  try {
    for (const name of names) {
      const store = transaction.objectStore(name)
      await store.clear()
      // A snapshot cannot safely resume a chain that may have advanced elsewhere.
      if (
        ['sessions', 'sesameUsers', 'senderKeyRecords', 'skippedSenderKeys', 'prekeys'].includes(
          name,
        )
      )
        continue
      for (const row of snapshotData.stores[name] ?? []) {
        const value = decode(row.value)
        if (store.keyPath === null) await store.put(value, row.key)
        else await store.put(value)
      }
    }
    await transaction.objectStore('metadata').put(newInstallId, metadataKey(INSTALL_NAME))
    await transaction.objectStore('metadata').put(snapshotData.accountId, metadataKey(ACCOUNT_NAME))
    await transaction.objectStore('metadata').put(
      JSON.stringify({
        oldInstallId: snapshotData.installId,
        newInstallId,
        proof: snapshotData.proof,
      }),
      metadataKey(PENDING_RESTORE),
    )
    await transaction.done
  } catch (error) {
    try {
      transaction.abort()
    } catch {}
    await transaction.done.catch(() => undefined)
    throw error
  }
  await resetE2EStore(snapshotData.accountId)
}

async function proofHash(proof: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

let backupTimer: ReturnType<typeof setTimeout> | null = null
const backupFlights = new Map<string, Promise<void>>()

export async function uploadRecoveryBackup(context: Context): Promise<void> {
  const previous = backupFlights.get(context.userId) ?? Promise.resolve()
  const work = previous
    .catch(() => undefined)
    .then(async () => {
      const run = () => performBackup(context)
      if (navigator.locks)
        await navigator.locks.request(`meapp:recovery-upload:${context.userId}`, run)
      else await run()
    })
  backupFlights.set(context.userId, work)
  try {
    await work
  } finally {
    if (backupFlights.get(context.userId) === work) backupFlights.delete(context.userId)
  }
}

async function performBackup(context: Context): Promise<void> {
  try {
    const key = await context.storage.getMetadata(KEY_NAME)
    const proof = await context.storage.getMetadata(PROOF_NAME)
    if (!key || !proof) throw new Error('Set up a recovery key first')
    if (await context.storage.getMetadata(PENDING_RESTORE))
      throw new Error('Complete recovery before updating the backup')
    if ((await context.storage.getMetadata(INSTALL_NAME)) !== context.installId)
      throw new Error('Backup device changed; reopen the app')
    const encrypted = await encryptSnapshot(await snapshot(context, proof), key)
    const chunkSize = RECOVERY_CHUNK_SIZE
    const total = Math.ceil(encrypted.ciphertext.length / chunkSize)
    if (total > RECOVERY_MAX_CHUNKS)
      throw new Error('Recovery backup exceeds the 50 MB encrypted upload limit')
    const uploadId = uuid()
    const hash = await proofHash(proof)
    for (let index = 0; index < total; index++) {
      await postFetcher(
        'e2e/recovery/backup/chunk',
        recoveryChunkSchema.parse({
          installId: context.installId,
          uploadId,
          proofHash: hash,
          iv: encrypted.iv,
          index,
          total,
          chunk: encrypted.ciphertext.slice(index * chunkSize, (index + 1) * chunkSize),
        }),
      )
    }
    await postFetcher('e2e/recovery/backup/commit', recoveryCommitSchema.parse({ uploadId }))
    await context.storage.setMetadata(ERROR_NAME, '')
  } catch (error) {
    await context.storage.setMetadata(
      ERROR_NAME,
      error instanceof Error ? error.message : 'Backup upload failed',
    )
    throw error
  }
}

export function scheduleRecoveryBackup(context: Context): void {
  if (backupTimer) clearTimeout(backupTimer)
  backupTimer = setTimeout(() => {
    backupTimer = null
    void context.storage
      .getMetadata(KEY_NAME)
      .then(async (key) => {
        if (key) await uploadRecoveryBackup(context)
      })
      .catch(() => undefined)
  }, 1500)
}

export async function createRecoveryKey(context: Context): Promise<string> {
  let key = await context.storage.getMetadata(KEY_NAME)
  if (!key) {
    key = phrase()
    const transaction = database(context.storage).transaction('metadata', 'readwrite')
    const current = (await transaction.store.get(metadataKey(KEY_NAME))) as string | undefined
    if (current) key = current
    else {
      await transaction.store.put(key, metadataKey(KEY_NAME))
      await transaction.store.put(phrase(), metadataKey(PROOF_NAME))
    }
    await transaction.done
  }
  await uploadRecoveryBackup(context)
  return key
}

export async function recoveryStatus(): Promise<RecoveryStatus> {
  const status = recoveryStatusSchema.parse(await getFetcher('e2e/recovery/status'))
  const me = await getFetcher<{ id: string }>('me')
  const storage = await getE2EStore(me.id)
  return {
    ...status,
    lastError: await storage.getMetadata(ERROR_NAME),
    canUpdate:
      !status.ownerInstallId || status.ownerInstallId === (await storage.getMetadata(INSTALL_NAME)),
  }
}

export async function restoreRecoveryBackup(accountId: string, keyText: string): Promise<void> {
  if (!navigator.locks) throw new Error('Recovery requires a browser with Web Locks support')
  return navigator.locks.request(`meapp:recovery:${accountId}`, async () => {
    const encrypted = recoveryBackupSchema.parse(await getFetcher('e2e/recovery/backup'))
    const data = await decryptSnapshot(accountId, keyText.trim(), encrypted)
    const newInstallId = localStorage.getItem(`${RESTORE_ID_PREFIX}${accountId}`) ?? uuid()
    localStorage.setItem(`${RESTORE_ID_PREFIX}${accountId}`, newInstallId)
    let storage = await getE2EStore(accountId)
    const pending = await storage.getMetadata(PENDING_RESTORE)
    if (pending) {
      const claim = JSON.parse(pending) as {
        oldInstallId: string
        newInstallId: string
        proof: string
      }
      if (
        claim.proof !== data.proof ||
        claim.oldInstallId !== data.installId ||
        claim.newInstallId !== newInstallId
      )
        throw new Error('Another recovery is pending in this browser')
    } else await restore(data, newInstallId)
    storage = await getE2EStore(accountId)
    await postFetcher(
      'e2e/recovery/claim',
      recoveryClaimSchema.parse({
        oldInstallId: data.installId,
        newInstallId,
        proof: data.proof,
      }),
    )
    await storage.setMetadata(PENDING_RESTORE, '')
    localStorage.removeItem(`${RESTORE_ID_PREFIX}${accountId}`)
    await uploadRecoveryBackup({ storage, userId: accountId, installId: newInstallId }).catch(
      () => undefined,
    )
  })
}
