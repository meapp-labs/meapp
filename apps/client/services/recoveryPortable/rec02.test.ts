import { expect, test } from 'bun:test'
import { decryptRecoverySnapshot, encryptPortableRecovery, phrase } from '../recoveryCodec'
import { rec01Snapshot } from './rec01.fixture'

test('portable encrypted transport preserves the logical snapshot with fresh nonces', async () => {
  const snapshot = rec01Snapshot()
  const key = phrase()
  const encrypted = await encryptPortableRecovery(snapshot, key)
  const another = await encryptPortableRecovery(snapshot, key)
  expect(encrypted.iv).not.toBe(another.iv)
  expect(await decryptRecoverySnapshot(snapshot.accountId, key, encrypted)).toEqual(snapshot)
})

test('portable encrypted transport rejects wrong keys, cross-account replay and tampering', async () => {
  const snapshot = rec01Snapshot()
  const key = phrase()
  const encrypted = await encryptPortableRecovery(snapshot, key)
  await expect(decryptRecoverySnapshot(snapshot.accountId, phrase(), encrypted)).rejects.toThrow(
    'incorrect',
  )
  await expect(decryptRecoverySnapshot('other-account', key, encrypted)).rejects.toThrow(
    'incorrect',
  )
  await expect(
    decryptRecoverySnapshot(snapshot.accountId, key, {
      ...encrypted,
      ciphertext: `AAAA${encrypted.ciphertext.slice(4)}`,
    }),
  ).rejects.toThrow('damaged')
})

test('browser portable recovery: SDK round trip, atomic failures, claims and legacy conversion', async () => {
  const child = Bun.spawn([process.execPath, 'services/recoveryPortable/rec02.fixture.ts'], {
    cwd: import.meta.dir.replace(/[\\/]services[\\/]recoveryPortable$/, ''),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`${stdout}\n${stderr}`)
  expect(stdout).toContain('REC-02 browser checks passed')
}, 30000)
