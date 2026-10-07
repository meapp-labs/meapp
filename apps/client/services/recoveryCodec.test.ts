import { expect, test } from 'bun:test'
import {
  type Snapshot,
  decode,
  decryptSnapshot,
  encode,
  encryptSnapshot,
  phrase,
} from './recoveryCodec'

const snapshot: Snapshot = {
  version: 1,
  storeVersion: 6,
  accountId: crypto.randomUUID(),
  installId: crypto.randomUUID(),
  proof: phrase(),
  stores: { metadata: [{ key: 'bytes', value: encode(new Uint8Array([0, 255, 41])) }] },
}
test('recovery round-trips authenticated encrypted snapshots and binary storage', async () => {
  const key = phrase()
  const encrypted = await encryptSnapshot(snapshot, key)
  expect(key).toHaveLength(43)
  const restored = await decryptSnapshot(snapshot.accountId, key, encrypted)
  expect(restored).toEqual(snapshot)
  expect(decode(restored.stores.metadata?.[0]?.value ?? null)).toEqual(new Uint8Array([0, 255, 41]))
})
test('wrong recovery key, wrong account and tampered ciphertext are rejected', async () => {
  const key = phrase()
  const encrypted = await encryptSnapshot(snapshot, key)
  await expect(decryptSnapshot(snapshot.accountId, phrase(), encrypted)).rejects.toThrow(
    'incorrect',
  )
  await expect(decryptSnapshot(crypto.randomUUID(), key, encrypted)).rejects.toThrow('incorrect')
  await expect(
    decryptSnapshot(snapshot.accountId, key, {
      ...encrypted,
      ciphertext: `AAAA${encrypted.ciphertext.slice(4)}`,
    }),
  ).rejects.toThrow('damaged')
})
test('authenticated unsupported snapshot versions are reported as incompatibility', async () => {
  const key = phrase()
  const encrypted = await encryptSnapshot({ ...snapshot, version: 2 } as unknown as Snapshot, key)
  await expect(decryptSnapshot(snapshot.accountId, key, encrypted)).rejects.toThrow('incompatible')
})
