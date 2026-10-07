import { expect, it } from 'bun:test'
import { pushTokenSchema } from './auth.ts'
import { messageWsIncomingSchema, wireMessageSchema } from './message.ts'

const identity = {
  id: crypto.randomUUID(),
  clientId: crypto.randomUUID(),
  roomId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  from: 'alice',
  sequence: 1,
  timestamp: '2026-10-07T00:00:00Z',
}

it('wire messages require identity, cursor and exactly one transport content variant', () => {
  expect(wireMessageSchema.safeParse({ ...identity, text: 'Hello' }).success).toBe(true)
  const encrypted = {
    ...identity,
    ciphertext: 'opaque',
    ciphertextType: 1,
    fromDeviceId: crypto.randomUUID(),
    fromProtocolDeviceId: 1,
  }
  expect(wireMessageSchema.safeParse(encrypted).success).toBe(true)
  for (const invalid of [
    { ...identity },
    { text: 'Hello' },
    { ...encrypted, text: 'leak' },
    { ...encrypted, fromDeviceId: undefined },
    { ...encrypted, ciphertextType: 2 },
    { ...identity, text: 'Hello', type: 'unexpected' },
    { ...identity, text: 'Hello', sequence: 0 },
  ])
    expect(wireMessageSchema.safeParse(invalid).success).toBe(false)
})

it('ticket authentication requires a nonempty ticket and push registration requires an Expo token', () => {
  expect(
    messageWsIncomingSchema.safeParse({ type: 'auth', payload: { ticket: 'ticket' } }).success,
  ).toBe(true)
  expect(
    messageWsIncomingSchema.safeParse({ type: 'auth', payload: { token: 'legacy' } }).success,
  ).toBe(false)
  expect(messageWsIncomingSchema.safeParse({ type: 'auth', payload: { ticket: '' } }).success).toBe(
    false,
  )
  for (const token of ['ExpoPushToken[abc-123_]', 'ExponentPushToken[abc]'])
    expect(pushTokenSchema.safeParse({ token }).success).toBe(true)
  for (const token of [
    'garbage',
    'ExpoPushToken[]',
    'ExpoPushToken[abc]\n',
    'ExpoPushToken[abc][def]',
  ])
    expect(pushTokenSchema.safeParse({ token }).success).toBe(false)
})
