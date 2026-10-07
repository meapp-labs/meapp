// Isolated process: IndexedDB globals never leak into unrelated test files.
import 'fake-indexeddb/auto'
import { expect } from 'bun:test'
import { ProtocolAddress } from '@open-e2ee/signal-protocol-sdk'
import {
  createCompositeIdentityV1,
  generateIdentityKeyPair,
} from '@open-e2ee/signal-protocol-sdk/keys'
import type { IDBPDatabase } from 'idb'
import { MeappIndexedDbStore } from '../e2eBrowserStore'
import { getPrivateMetadata, setPrivateMetadata } from '../e2ePrivateMetadata.web'
import { type Snapshot, encode, phrase } from '../recoveryCodec'
import { BrowserRecoveryAdapter, convertLegacyBrowserSnapshot } from './browser'
import { claimForSnapshot } from './contract'

const accountId = crypto.randomUUID()
const sourceInstallId = crypto.randomUUID()
const proof = phrase()
const open = async (name: string) => {
  const store = new MeappIndexedDbStore()
  Reflect.set(store, 'dbName', name)
  await store.initialize()
  return store
}
const db = (store: MeappIndexedDbStore) => Reflect.get(store, 'db') as IDBPDatabase
const source = await open(`rec02-source-${accountId}`)
await source.setMetadata('meapp:e2e:account', accountId)
await source.setMetadata('meapp:e2e:install', sourceInstallId)
await source.setMetadata('meapp:e2e:device-id', '3')
await source.setMetadata('meapp:e2e:recovery-proof', proof)
const identity = await generateIdentityKeyPair()
await source.storeIdentityKey(identity)
await source.setLocalRegistrationId(identity.registrationId)
const peer = await generateIdentityKeyPair()
const address = ProtocolAddress.create('peer', 2)
await source.saveContactIdentity(address, createCompositeIdentityV1(peer))
await source.verifyContactIdentity(address, createCompositeIdentityV1(peer))
const historyKey = 'meapp:e2e:message-content:v1:message-one'
await setPrivateMetadata(source, historyKey, '{"text":"saved private history ✓"}')
await setPrivateMetadata(source, 'meapp:e2e:message:legacy-one', 'legacy cached history')
await setPrivateMetadata(source, 'meapp:e2e:outbox', '["never-replay"]')
await setPrivateMetadata(source, 'meapp:media:uploads:v1', 'upload-retry-bytes')
const received = {
  id: 'sdk-history',
  plaintext: 'received history',
  receivedAt: Date.now(),
  groupId: 'group',
}
const sdkEncrypt = async (text: string) =>
  Reflect.get(source, 'encrypt').call(source, text) as Promise<Uint8Array>
await db(source).put(
  'metadata',
  await sdkEncrypt(JSON.stringify(received)),
  `received-content:${received.id}`,
)
await db(source).put('sessions', {
  key: 'stale',
  userId: 'peer',
  updatedAt: 1,
  data: new Uint8Array([1]),
})
await db(source).put('sesameUsers', { key: 'stale', data: new Uint8Array([1]) })
await db(source).put('prekeys', new Uint8Array([1]), 'old-prekey')
const context = { accountId, installId: sourceInstallId, deviceId: 3, proof, createdAt: Date.now() }
const adapter = new BrowserRecoveryAdapter(accountId, source)
const snapshot = await adapter.exportSnapshot(context)
expect(snapshot.identities[0]?.keyPair).toEqual(identity)
expect(snapshot.contacts[0]?.record.trustState).toBe('VERIFIED')
expect(snapshot.receivedContent).toEqual([received])
expect(snapshot.privateMetadata).toHaveLength(2)
expect(JSON.stringify(snapshot)).not.toContain('never-replay')
expect(JSON.stringify(snapshot)).not.toContain('upload-retry-bytes')
expect(JSON.stringify(snapshot)).not.toContain('databaseKey')
await expect(adapter.exportSnapshot({ ...context, deviceId: 4 })).rejects.toThrow('device binding')
await expect(adapter.exportSnapshot({ ...context, accountId: 'other' })).rejects.toThrow(
  'another account',
)

const destinationName = `rec02-destination-${accountId}`
let destination = await open(destinationName)
let destinationAdapter = new BrowserRecoveryAdapter(accountId, destination)
const destinationKey = await destination.getDatabaseKey()
const claim = claimForSnapshot(snapshot, crypto.randomUUID())
await destinationAdapter.importSnapshot(snapshot, claim)
expect(await destination.getIdentityKey()).toEqual(identity)
expect(await destination.getLocalRegistrationId()).toBe(identity.registrationId)
expect(await destination.getContactIdentity(address)).toEqual(
  await source.getContactIdentity(address),
)
expect(await destination.getReceivedContent(received.id)).toEqual(received)
expect(await getPrivateMetadata(destination, historyKey)).toBe('{"text":"saved private history ✓"}')
expect(await getPrivateMetadata(destination, 'meapp:e2e:message:legacy-one')).toBe(
  'legacy cached history',
)
expect(await destination.getDatabaseKey()).toEqual(destinationKey)
expect(await destination.getDatabaseKey()).not.toEqual(await source.getDatabaseKey())
expect(await destination.getMetadata('meapp:e2e:private-metadata-key')).not.toEqual(
  await source.getMetadata('meapp:e2e:private-metadata-key'),
)
expect(await destination.getMetadata(historyKey)).not.toEqual(await source.getMetadata(historyKey))
expect(await destination.getMetadata('meapp:e2e:outbox')).toBeNull()
expect(await destination.getMetadata('meapp:e2e:device-id')).toBe('3')
for (const name of [
  'sessions',
  'sesameUsers',
  'senderKeyRecords',
  'skippedSenderKeys',
  'prekeys',
  'messageRecords',
])
  expect(await db(destination).count(name)).toBe(0)
await expect(
  destinationAdapter.exportSnapshot({ ...context, installId: claim.newInstallId }),
).rejects.toThrow('pending recovery')
await expect(destinationAdapter.importSnapshot(snapshot, claim)).rejects.toThrow(
  'already has encryption keys',
)
destination.close()
destination = await open(destinationName)
destinationAdapter = new BrowserRecoveryAdapter(accountId, destination)
expect(await destinationAdapter.readPendingClaim(accountId)).toEqual(claim)
await expect(
  destinationAdapter.completePendingClaim({ ...claim, proof: phrase() }),
).rejects.toThrow('changed')
expect(await destinationAdapter.readPendingClaim(accountId)).toEqual(claim)
await destinationAdapter.completePendingClaim(claim)
expect(await destinationAdapter.readPendingClaim(accountId)).toBeNull()
const secondSnapshot = await destinationAdapter.exportSnapshot({
  ...context,
  installId: claim.newInstallId,
})
expect(secondSnapshot.identities).toEqual(snapshot.identities)
expect(secondSnapshot.privateMetadata).toEqual(snapshot.privateMetadata)

// A late write failure must restore cleared stores and preserve the destination key.
const failure = await open(`rec02-failure-${accountId}`)
await failure.setMetadata('sentinel', 'keep-me')
await db(failure).put('prekeys', 'untouched', 'sentinel-prekey')
const realDb = db(failure)
Reflect.set(
  failure,
  'db',
  new Proxy(realDb, {
    get(target, property) {
      if (property !== 'transaction') {
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (...args: Parameters<IDBPDatabase['transaction']>) => {
        const tx = target.transaction(...args)
        return new Proxy(tx, {
          get(transaction, name) {
            if (name === 'objectStore')
              return (storeName: string) => {
                const objectStore = transaction.objectStore(storeName)
                if (storeName !== 'contacts') return objectStore
                return new Proxy(objectStore, {
                  get(storeTarget, field) {
                    if (field === 'put')
                      return () => {
                        throw new Error('Injected late write failure')
                      }
                    const value = Reflect.get(storeTarget, field, storeTarget)
                    return typeof value === 'function' ? value.bind(storeTarget) : value
                  },
                })
              }
            const value = Reflect.get(transaction, name, transaction)
            return typeof value === 'function' ? value.bind(transaction) : value
          },
        })
      }
    },
  }),
)
await expect(
  new BrowserRecoveryAdapter(accountId, failure).importSnapshot(snapshot, claim),
).rejects.toThrow('late write failure')
Reflect.set(failure, 'db', realDb)
expect(await failure.getIdentityKey()).toBeNull()
expect(await failure.getMetadata('sentinel')).toBe('keep-me')
expect(await realDb.get('prekeys', 'sentinel-prekey')).toBe('untouched')
expect(await failure.getMetadata('meapp:e2e:restore-pending')).toBeNull()

// Competing adapter instances are serialized by the IDB write transaction itself.
const concurrent = await open(`rec02-concurrent-${accountId}`)
const outcomes = await Promise.allSettled([
  new BrowserRecoveryAdapter(accountId, concurrent).importSnapshot(snapshot, claim),
  new BrowserRecoveryAdapter(accountId, concurrent).importSnapshot(
    snapshot,
    claimForSnapshot(snapshot, crypto.randomUUID()),
  ),
])
expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1)
expect(await concurrent.getIdentityKey()).toEqual(identity)

// Convert a real SDK-6 legacy snapshot, without opening or writing a destination.
const stores: Snapshot['stores'] = {}
for (const name of Array.from(db(source).objectStoreNames)) {
  const [keys, values] = await Promise.all([db(source).getAllKeys(name), db(source).getAll(name)])
  stores[name] = keys.map((key, index) => ({
    key: key as string | number,
    value: encode(values[index]),
  }))
}
const legacy: Snapshot = {
  version: 1,
  storeVersion: 6,
  accountId,
  installId: sourceInstallId,
  proof,
  stores,
}
expect(await convertLegacyBrowserSnapshot(legacy, accountId, context.createdAt)).toEqual(snapshot)
await expect(
  convertLegacyBrowserSnapshot({ ...legacy, storeVersion: 7 }, accountId, context.createdAt),
).rejects.toThrow('Unsupported legacy')
await expect(
  convertLegacyBrowserSnapshot({ ...legacy, accountId: 'other' }, accountId, context.createdAt),
).rejects.toThrow('another account')
await expect(
  convertLegacyBrowserSnapshot(
    { ...legacy, stores: { ...stores, unexpected: [] } },
    accountId,
    context.createdAt,
  ),
).rejects.toThrow('store set')
await expect(
  convertLegacyBrowserSnapshot(
    {
      ...legacy,
      stores: { ...stores, identity: [...(stores.identity ?? []), ...(stores.identity ?? [])] },
    },
    accountId,
    context.createdAt,
  ),
).rejects.toThrow('duplicate')
await expect(
  convertLegacyBrowserSnapshot(
    {
      ...legacy,
      stores: { ...stores, contacts: [{ key: 'mismatch', value: encode({ key: 'different' }) }] },
    },
    accountId,
    context.createdAt,
  ),
).rejects.toThrow('inline row')

await source.setMetadata('meapp:e2e:restore-pending', JSON.stringify(claim))
await expect(adapter.exportSnapshot(context)).rejects.toThrow('pending recovery')
for (const store of [source, destination, failure, concurrent]) store.close()
console.log('REC-02 browser checks passed')
