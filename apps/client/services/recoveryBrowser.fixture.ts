// Isolated process: module mocks must not affect unrelated client tests.
import 'fake-indexeddb/auto'
import { expect, mock } from 'bun:test'
import { ProtocolAddress, createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk'
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory'
import { inMemoryRelay } from '@open-e2ee/signal-protocol-sdk/remote/relay/memory'
import type { IDBPDatabase } from 'idb'
import { MeappIndexedDbStore } from './e2eBrowserStore'
import { getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata.web'
import {
  type Snapshot,
  decryptRecoverySnapshot,
  encode,
  encryptSnapshot,
  phrase,
} from './recoveryCodec'

const accountId = crypto.randomUUID()
const oldInstallId = crypto.randomUUID()
const bobId = crypto.randomUUID()
let dbName = 'recovery-original'
let current: MeappIndexedDbStore | null = null
async function store() {
  if (!current) {
    current = new MeappIndexedDbStore()
    Reflect.set(current, 'dbName', dbName)
    await current.initialize()
  }
  return current
}
const local = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value),
    removeItem: (key: string) => local.delete(key),
  },
})
Object.defineProperty(globalThis, 'navigator', {
  value: { locks: { request: async (_name: string, work: () => Promise<unknown>) => work() } },
  configurable: true,
})
const relay = inMemoryRelay()
let backup: { iv: string; ciphertext: string } = { iv: '', ciphertext: '' }
let owner: string = oldInstallId
let failClaim = true
let failUpload = false
const claims: unknown[] = []
let upload: { iv: string; installId: string; chunks: string[] } = {
  iv: '',
  installId: '',
  chunks: [],
}
mock.module('./e2eStore', () => ({
  getE2EStore: store,
  resetE2EStore: async () => {
    current?.close()
    current = null
  },
}))
mock.module('@/lib/uuid', () => ({ uuid: () => crypto.randomUUID() }))
mock.module('@/lib/api', () => ({
  getFetcher: async (path: string) => {
    if (path === 'me') return { id: accountId }
    if (path === 'e2e/recovery/backup') return { version: 1, ...backup }
    if (path === 'e2e/recovery/status')
      return {
        available: true,
        ownerInstallId: owner,
        updatedAt: 1,
        size: backup.ciphertext.length,
        maxBytes: 50_000_000,
        uploadExpiresAfterMs: 3_600_000,
      }
    throw new Error(path)
  },
  postFetcher: async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/claim')) {
      claims.push(body)
      if (failClaim) throw new Error('Connection interrupted during claim')
      owner = String(body.newInstallId)
      await relay.removeDevice(accountId, 1)
      return { recovered: true }
    }
    if (failUpload) throw new Error('Upload interrupted')
    if (path.endsWith('/chunk')) {
      if (body.index === 0)
        upload = { iv: String(body.iv), installId: String(body.installId), chunks: [] }
      upload.chunks[Number(body.index)] = String(body.chunk)
      return { uploaded: body.index }
    }
    if (path.endsWith('/commit')) {
      backup = { iv: upload.iv, ciphertext: upload.chunks.join('') }
      owner = upload.installId
      return { updatedAt: 1 }
    }
    throw new Error(path)
  },
}))
const { createRecoveryKey, restoreRecoveryBackup, uploadRecoveryBackup, recoveryStatus } =
  await import('./recovery.web')
const original = await store()
await original.setMetadata('meapp:e2e:account', accountId)
await original.setMetadata('meapp:e2e:install', oldInstallId)
await original.setMetadata('meapp:e2e:device-id', '1')
await setPrivateMetadata(original, 'meapp:e2e:message-content:v1:history', 'saved-history')
const alice = await createSignalProtocolClient({
  identity: { userId: accountId, deviceId: 1 },
  adapters: { storage: original, relay },
})
const bob = await createSignalProtocolClient({
  identity: { userId: bobId, deviceId: 1 },
  adapters: { storage: inMemoryStore(), relay },
})
await alice.syncToServer()
await bob.syncToServer()
const bobAddress = ProtocolAddress.create(bobId, 1)
const aliceAddress = ProtocolAddress.create(accountId, 1)
const bundle = await relay.fetchPreKeyBundle(bobId, 1)
if (!bundle) throw new Error('Missing prekey bundle')
await alice.establishSession(bobAddress, bundle)
expect(
  await bob.decryptMessage(aliceAddress, await alice.encryptMessage(bobAddress, 'before snapshot')),
).toBe('before snapshot')
const originalIdentity = await original.getIdentityKey()
const key = await createRecoveryKey({
  storage: original,
  userId: accountId,
  installId: oldInstallId,
})
const portableSaved = backup
const portableData = await decryptRecoverySnapshot(accountId, key, portableSaved)
expect(portableData.version).toBe(2)
expect('stores' in portableData).toBe(false)
// Retain explicit legacy acceptance coverage after uploads switch to portable data.
const originalDb = Reflect.get(original, 'db') as IDBPDatabase
const legacyStores: Snapshot['stores'] = {}
for (const name of Array.from(originalDb.objectStoreNames)) {
  const [keys, values] = await Promise.all([originalDb.getAllKeys(name), originalDb.getAll(name)])
  legacyStores[name] = keys.map((key, index) => ({
    key: key as string | number,
    value: encode(values[index]),
  }))
}
const proof = await original.getMetadata('meapp:e2e:recovery-proof')
if (!proof) throw new Error('Missing recovery proof')
const data: Snapshot = {
  version: 1,
  storeVersion: 6,
  accountId,
  installId: oldInstallId,
  proof,
  stores: legacyStores,
}
const saved = await encryptSnapshot(data, key)
expect(data.stores.sessions?.length).toBeGreaterThan(0)
expect(
  await bob.decryptMessage(aliceAddress, await alice.encryptMessage(bobAddress, 'after snapshot')),
).toBe('after snapshot')
expect(
  await alice.decryptMessage(bobAddress, await bob.encryptMessage(aliceAddress, 'advanced reply')),
).toBe('advanced reply')
original.close()
current = null
dbName = 'recovery-replacement'

backup = await encryptSnapshot({ ...data, storeVersion: 999 }, key)
await expect(restoreRecoveryBackup(accountId, key)).rejects.toThrow('legacy browser store version')
expect(await (await store()).getIdentityKey()).toBeNull()

backup = await encryptSnapshot(
  {
    ...data,
    stores: { ...data.stores, messageRecords: [{ key: 'broken', value: 'no inline key' }] },
  },
  key,
)
await expect(restoreRecoveryBackup(accountId, key)).rejects.toThrow()
expect(await (await store()).getIdentityKey()).toBeNull()

backup = saved
await expect(restoreRecoveryBackup(accountId, key)).rejects.toThrow('interrupted during claim')
let restored = await store()
expect(await restored.getIdentityKey()).toEqual(originalIdentity)
expect(await restored.getMetadata('meapp:e2e:restore-pending')).toBeTruthy()
const database = Reflect.get(restored, 'db') as IDBPDatabase
for (const name of ['sessions', 'sesameUsers', 'senderKeyRecords', 'skippedSenderKeys', 'prekeys'])
  expect(await database.count(name)).toBe(0)
expect(await getPrivateMetadata(restored, 'meapp:e2e:message-content:v1:history')).toBe(
  'saved-history',
)
// Resume from persisted IndexedDB state after closing the interrupted instance.
restored.close()
current = null
failClaim = false
await restoreRecoveryBackup(accountId, key)
expect(claims).toHaveLength(2)
expect(claims[0]).toEqual(claims[1])
restored = await store()
expect(await restored.getMetadata('meapp:e2e:restore-pending')).toBeNull()
const recovered = await createSignalProtocolClient({
  identity: { userId: accountId, deviceId: 1 },
  adapters: { storage: restored, relay },
})
await recovered.syncToServer()
expect(await restored.getIdentityKey()).toEqual(originalIdentity)
const freshBundle = await relay.fetchPreKeyBundle(bobId, 1)
if (!freshBundle) throw new Error('Missing fresh prekey bundle')
await recovered.establishSession(bobAddress, freshBundle)
expect(
  await bob.decryptMessage(aliceAddress, await recovered.encryptMessage(bobAddress, 'fresh chain')),
).toBe('fresh chain')
expect(
  await recovered.decryptMessage(bobAddress, await bob.encryptMessage(aliceAddress, 'fresh reply')),
).toBe('fresh reply')
failUpload = true
const beforeFailedUpload = backup
await expect(
  uploadRecoveryBackup({ storage: restored, userId: accountId, installId: owner }),
).rejects.toThrow('Upload interrupted')
expect((await recoveryStatus()).lastError).toBe('Upload interrupted')
expect(backup).toEqual(beforeFailedUpload)
failUpload = false
await uploadRecoveryBackup({ storage: restored, userId: accountId, installId: owner })
expect((await recoveryStatus()).lastError).toBe('')
restored.close()
current = null
dbName = 'recovery-portable-replacement'
backup = portableSaved
await expect(restoreRecoveryBackup(accountId, phrase())).rejects.toThrow('incorrect')
expect(await (await store()).getIdentityKey()).toBeNull()
failClaim = true
await expect(restoreRecoveryBackup(accountId, key)).rejects.toThrow('interrupted during claim')
let portableRestored = await store()
expect(await portableRestored.getIdentityKey()).toEqual(originalIdentity)
expect(await getPrivateMetadata(portableRestored, 'meapp:e2e:message-content:v1:history')).toBe(
  'saved-history',
)
portableRestored.close()
current = null
failClaim = false
await restoreRecoveryBackup(accountId, key)
portableRestored = await store()
expect(await portableRestored.getMetadata('meapp:e2e:restore-pending')).toBeNull()
const portableClient = await createSignalProtocolClient({
  identity: { userId: accountId, deviceId: 1 },
  adapters: { storage: portableRestored, relay },
})
await portableClient.syncToServer()
const portableBundle = await relay.fetchPreKeyBundle(bobId, 1)
if (!portableBundle) throw new Error('Missing fresh portable prekey bundle')
await portableClient.establishSession(bobAddress, portableBundle)
expect(
  await bob.decryptMessage(
    aliceAddress,
    await portableClient.encryptMessage(bobAddress, 'portable fresh chain'),
  ),
).toBe('portable fresh chain')
expect(
  await portableClient.decryptMessage(
    bobAddress,
    await bob.encryptMessage(aliceAddress, 'portable fresh reply'),
  ),
).toBe('portable fresh reply')
portableRestored.close()
console.log(
  'Browser restore: compatibility, atomic rollback, claim retry, stale ratchets, history and failure status passed',
)
