// Disposable real-browser acceptance harness. Bundle this entry with Bun, serve
// on loopback, and inspect its visible result. No account/server access is used.
import { ProtocolAddress } from '@open-e2ee/signal-protocol-sdk'
import {
  createCompositeIdentityV1,
  generateIdentityKeyPair,
} from '@open-e2ee/signal-protocol-sdk/keys'
import { deleteDB } from 'idb'
import { MeappIndexedDbStore } from '../e2eBrowserStore'
import { getPrivateMetadata, setPrivateMetadata } from '../e2ePrivateMetadata.web'
import { phrase } from '../recoveryCodec'
import { BrowserRecoveryAdapter } from './browser'
import { claimForSnapshot } from './contract'

async function run(): Promise<void> {
  const accountId = crypto.randomUUID()
  const names = [`rec02-browser-source-${accountId}`, `rec02-browser-target-${accountId}`]
  const stores: MeappIndexedDbStore[] = []
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message)
  }
  const canonical = (value: unknown) =>
    JSON.stringify(value, (_key, part: unknown) =>
      part && typeof part === 'object' && !Array.isArray(part)
        ? Object.fromEntries(
            Object.entries(part).sort(([left], [right]) => left.localeCompare(right)),
          )
        : part,
    )
  const open = async (name: string) => {
    const storage = new MeappIndexedDbStore()
    Reflect.set(storage, 'dbName', name)
    await storage.initialize()
    stores.push(storage)
    return storage
  }
  try {
    const source = await open(names[0] ?? '')
    const installId = crypto.randomUUID()
    const proof = phrase()
    await source.setMetadata('meapp:e2e:account', accountId)
    await source.setMetadata('meapp:e2e:install', installId)
    await source.setMetadata('meapp:e2e:device-id', '2')
    await source.setMetadata('meapp:e2e:recovery-proof', proof)
    const identity = await generateIdentityKeyPair()
    await source.storeIdentityKey(identity)
    // Exercise the real SDK's missing registration metadata behavior.
    const peer = await generateIdentityKeyPair()
    const address = ProtocolAddress.create('browser-peer', 1)
    await source.saveContactIdentity(address, createCompositeIdentityV1(peer))
    await source.verifyContactIdentity(address, createCompositeIdentityV1(peer))
    const historyKey = 'meapp:e2e:message-content:v1:browser-history'
    await setPrivateMetadata(source, historyKey, 'real browser private history ✓')
    const snapshot = await new BrowserRecoveryAdapter(accountId, source).exportSnapshot({
      accountId,
      installId,
      proof,
      deviceId: 2,
      createdAt: Date.now(),
    })
    const destination = await open(names[1] ?? '')
    const competing = await open(names[1] ?? '')
    const claim = claimForSnapshot(snapshot, crypto.randomUUID())
    const other = claimForSnapshot(snapshot, crypto.randomUUID())
    const outcomes = await Promise.allSettled([
      new BrowserRecoveryAdapter(accountId, destination).importSnapshot(snapshot, claim),
      new BrowserRecoveryAdapter(accountId, competing).importSnapshot(snapshot, other),
    ])
    assert(
      outcomes.filter((result) => result.status === 'fulfilled').length === 1,
      'Exactly one concurrent import must win',
    )
    assert(
      JSON.stringify(await destination.getIdentityKey()) === JSON.stringify(identity),
      'Identity must survive',
    )
    assert(
      (await getPrivateMetadata(destination, historyKey)) === 'real browser private history ✓',
      'History must survive',
    )
    assert(
      canonical(await destination.getContactIdentity(address)) ===
        canonical(await source.getContactIdentity(address)),
      'Trust must survive',
    )
    const adapter = new BrowserRecoveryAdapter(accountId, destination)
    const pending = await adapter.readPendingClaim(accountId)
    assert(pending !== null, 'Claim must be durable')
    destination.close()
    competing.close()
    const reopened = await open(names[1] ?? '')
    const reopenedAdapter = new BrowserRecoveryAdapter(accountId, reopened)
    assert(
      JSON.stringify(await reopenedAdapter.readPendingClaim(accountId)) === JSON.stringify(pending),
      'Claim must survive reopen',
    )
    if (!pending) throw new Error('Missing claim')
    await reopenedAdapter.completePendingClaim(pending)
    assert((await reopenedAdapter.readPendingClaim(accountId)) === null, 'Exact claim must clear')
    document.body.textContent =
      'PASS: real IndexedDB round trip; identity, trust and encrypted history; concurrent connections; claim persistence and completion.'
  } finally {
    for (const store of stores) store.close()
    for (const name of names) await deleteDB(name)
  }
}

void run().catch((error: unknown) => {
  document.body.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`
})
