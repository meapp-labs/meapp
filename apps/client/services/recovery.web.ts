import type { SignalProtocolLocalStore } from '@open-e2ee/signal-protocol-sdk'
import type { IDBPDatabase } from 'idb'

import { getFetcher, postFetcher } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import { getE2EStore, resetE2EStore } from './e2eStore'

const KEY_NAME = 'meapp:e2e:recovery-key'
const PROOF_NAME = 'meapp:e2e:recovery-proof'
const INSTALL_NAME = 'meapp:e2e:install'
const ACCOUNT_NAME = 'meapp:e2e:account'
const RESTORE_ID_PREFIX = 'meapp:e2e:restore-install:'

type Encoded = null | string | number | boolean | Encoded[] | { [key: string]: Encoded }
type StoreRow = { key: string | number; value: Encoded }
type Snapshot = {
  version: 1
  accountId: string
  installId: string
  proof: string
  stores: Record<string, StoreRow[]>
}
type Context = { storage: SignalProtocolLocalStore; userId: string; installId: string }

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function bytes(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
}

function buffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(value.length))
  copy.set(value)
  return copy.buffer
}

const phrase = () =>
  base64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
const phraseBytes = (value: string) =>
  bytes(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4))

function encode(value: unknown): Encoded {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Uint8Array) return { $meappBytes: base64(value) }
  if (value instanceof ArrayBuffer) return { $meappBuffer: base64(new Uint8Array(value)) }
  if (Array.isArray(value)) return value.map(encode)
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, encode(part)]))
  }
  throw new Error('Encrypted device storage contains an unsupported value')
}

function decode(value: Encoded): unknown {
  if (Array.isArray(value)) return value.map(decode)
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$meappBytes === 'string')
      return bytes(value.$meappBytes)
    if (Object.keys(value).length === 1 && typeof value.$meappBuffer === 'string')
      return buffer(bytes(value.$meappBuffer))
    return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, decode(part)]))
  }
  return value
}

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
        keys.map((key, index) => ({ key: key as string | number, value: encode(values[index]) })),
      ] as const
    }),
  )
  await transaction.done
  return {
    version: 1,
    accountId: context.userId,
    installId: context.installId,
    proof,
    stores: Object.fromEntries(entries),
  }
}

async function restore(snapshotData: Snapshot): Promise<void> {
  const storage = await getE2EStore(snapshotData.accountId)
  if (await storage.getIdentityKey()) throw new Error('This browser already has encryption keys')
  const db = database(storage)
  const names = Array.from(db.objectStoreNames)
  if (
    names.length !== Object.keys(snapshotData.stores).length ||
    names.some((name) => !Array.isArray(snapshotData.stores[name]))
  ) {
    throw new Error('Recovery backup is incompatible with this app version')
  }
  const transaction = db.transaction(names, 'readwrite')
  for (const name of names) {
    const store = transaction.objectStore(name)
    await store.clear()
    for (const row of snapshotData.stores[name] ?? []) {
      const value = decode(row.value)
      if (store.keyPath === null) await store.put(value, row.key)
      else await store.put(value)
    }
  }
  await transaction.done
  await resetE2EStore(snapshotData.accountId)
}

async function compress(plaintext: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip')
  const pending = new Response(stream.readable).arrayBuffer()
  const sink = stream.writable.getWriter()
  await sink.write(buffer(plaintext))
  await sink.close()
  return new Uint8Array(await pending)
}

async function decompress(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip')
  const pending = new Response(stream.readable).arrayBuffer()
  const sink = stream.writable.getWriter()
  await sink.write(buffer(compressed))
  await sink.close()
  return new Uint8Array(await pending)
}

async function encryptSnapshot(data: Snapshot, keyText: string) {
  const key = await crypto.subtle.importKey('raw', buffer(phraseBytes(keyText)), 'AES-GCM', false, [
    'encrypt',
  ])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = await compress(new TextEncoder().encode(JSON.stringify(data)))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buffer(iv), additionalData: new TextEncoder().encode(data.accountId) },
    key,
    buffer(plaintext),
  )
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) }
}

async function decryptSnapshot(
  accountId: string,
  keyText: string,
  encrypted: { iv: string; ciphertext: string },
): Promise<Snapshot> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(keyText)) throw new Error('Enter the complete recovery key')
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      buffer(phraseBytes(keyText)),
      'AES-GCM',
      false,
      ['decrypt'],
    )
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: buffer(bytes(encrypted.iv)),
        additionalData: new TextEncoder().encode(accountId),
      },
      key,
      buffer(bytes(encrypted.ciphertext)),
    )
    const parsed = JSON.parse(
      new TextDecoder().decode(await decompress(new Uint8Array(plaintext))),
    ) as Snapshot
    if (
      parsed.version !== 1 ||
      parsed.accountId !== accountId ||
      !parsed.installId ||
      !parsed.proof ||
      !parsed.stores
    )
      throw new Error('Invalid recovery backup')
    return parsed
  } catch {
    throw new Error('Recovery key is incorrect or the backup is damaged')
  }
}

async function proofHash(proof: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

let backupTimer: ReturnType<typeof setTimeout> | null = null
let backupInFlight: Promise<void> | null = null

export async function uploadRecoveryBackup(context: Context): Promise<void> {
  const key = await context.storage.getMetadata(KEY_NAME)
  const proof = await context.storage.getMetadata(PROOF_NAME)
  if (!key || !proof) throw new Error('Set up a recovery key first')
  if (backupInFlight) await backupInFlight
  const work = (async () => {
    const encrypted = await encryptSnapshot(await snapshot(context, proof), key)
    const chunkSize = 500_000
    const total = Math.ceil(encrypted.ciphertext.length / chunkSize)
    if (total > 100) throw new Error('Recovery backup is too large to upload')
    const uploadId = uuid()
    const hash = await proofHash(proof)
    for (let index = 0; index < total; index++) {
      await postFetcher('e2e/recovery/backup/chunk', {
        installId: context.installId,
        uploadId,
        proofHash: hash,
        iv: encrypted.iv,
        index,
        total,
        chunk: encrypted.ciphertext.slice(index * chunkSize, (index + 1) * chunkSize),
      })
    }
    await postFetcher('e2e/recovery/backup/commit', { uploadId })
  })()
  backupInFlight = work
  try {
    await work
  } finally {
    if (backupInFlight === work) backupInFlight = null
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
    await context.storage.setMetadata(KEY_NAME, key)
    await context.storage.setMetadata(PROOF_NAME, phrase())
  }
  await uploadRecoveryBackup(context)
  return key
}

export async function recoveryStatus(): Promise<{ available: boolean; updatedAt: number | null }> {
  return getFetcher('e2e/recovery/status')
}

export async function restoreRecoveryBackup(accountId: string, keyText: string): Promise<void> {
  const encrypted = await getFetcher<{ iv: string; ciphertext: string }>('e2e/recovery/backup')
  const data = await decryptSnapshot(accountId, keyText.trim(), encrypted)
  const newInstallId = localStorage.getItem(`${RESTORE_ID_PREFIX}${accountId}`) ?? uuid()
  localStorage.setItem(`${RESTORE_ID_PREFIX}${accountId}`, newInstallId)
  await restore(data)
  const storage = await getE2EStore(accountId)
  await storage.setMetadata(INSTALL_NAME, newInstallId)
  await storage.setMetadata(ACCOUNT_NAME, accountId)
  await postFetcher('e2e/recovery/claim', {
    oldInstallId: data.installId,
    newInstallId,
    proof: data.proof,
  })
  localStorage.removeItem(`${RESTORE_ID_PREFIX}${accountId}`)
  await uploadRecoveryBackup({ storage, userId: accountId, installId: newInstallId }).catch(
    () => undefined,
  )
}
