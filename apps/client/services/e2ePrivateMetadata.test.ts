import { expect, test } from 'bun:test'
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory'

import { getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata.web'

test('private metadata is encrypted and rejects modification', async () => {
  const storage = inMemoryStore()
  const plaintext = 'a private chat message'
  await setPrivateMetadata(storage, 'message', plaintext)
  const saved = await storage.getMetadata('message')
  expect(saved).not.toBe(plaintext)
  expect(saved).not.toContain(plaintext)
  expect(await getPrivateMetadata(storage, 'message')).toBe(plaintext)

  if (!saved) throw new Error('Missing encrypted metadata')
  await storage.setMetadata('message', `${saved.slice(0, -2)}AA`)
  expect(getPrivateMetadata(storage, 'message')).rejects.toThrow()
})
