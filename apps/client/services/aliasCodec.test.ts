import { expect, test } from 'bun:test'
import { type AliasCrypto, openAlias, sealAlias } from './aliasCodec'

const owner = crypto.randomUUID()
const contact = crypto.randomUUID()
const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const backend: AliasCrypto = {
  hash: async (input) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(input))),
  seal: async (input, key) => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const imported = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, [
      'encrypt',
    ])
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      imported,
      new Uint8Array(input),
    )
    return Buffer.concat([iv, Buffer.from(ciphertext)]).toString('base64')
  },
  open: async (ciphertext, key) => {
    const bytes = Buffer.from(ciphertext, 'base64')
    const imported = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, [
      'decrypt',
    ])
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.subarray(0, 12) },
        imported,
        bytes.subarray(12),
      ),
    )
  },
}

test('aliases sync with the linked account identity and fresh nonces without exposing names', async () => {
  const first = await sealAlias(backend, owner, contact, secret, '  Private name  ')
  const second = await sealAlias(backend, owner, contact, secret, 'Private name')
  expect(first).not.toBe(second)
  expect(Buffer.from(first, 'base64').toString()).not.toContain('Private name')
  expect(await openAlias(backend, owner, contact, secret, first)).toBe('Private name')
  const removed = await sealAlias(backend, owner, contact, secret, '')
  expect(await openAlias(backend, owner, contact, secret, removed)).toBeNull()
})

test('aliases reject cross-account or cross-contact substitution, another identity, and tampering', async () => {
  const ciphertext = await sealAlias(backend, owner, contact, secret, 'Private name')
  await expect(
    openAlias(backend, crypto.randomUUID(), contact, secret, ciphertext),
  ).rejects.toThrow()
  await expect(openAlias(backend, owner, crypto.randomUUID(), secret, ciphertext)).rejects.toThrow(
    'different contact',
  )
  await expect(openAlias(backend, owner, contact, 'different secret', ciphertext)).rejects.toThrow()
  const modified = Buffer.from(ciphertext, 'base64')
  modified[20] = (modified[20] ?? 0) ^ 1
  await expect(
    openAlias(backend, owner, contact, secret, modified.toString('base64')),
  ).rejects.toThrow()
})
