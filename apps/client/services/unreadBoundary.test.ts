import { expect, test } from 'bun:test'
import type { Message } from '@meapp/shared'
import { updateUnreadBoundary } from './unreadBoundary'

const incoming = (sequence: number, acknowledgedRead = false): Message => ({
  id: crypto.randomUUID(),
  sequence,
  from: 'alice',
  text: 'hello',
  type: 'text',
  acknowledgedRead,
})

test('keeps the opening landmark after read acknowledgements and history refreshes', () => {
  const start = updateUnreadBoundary(null, [incoming(8), incoming(1)], 'bob', 1)
  expect(
    updateUnreadBoundary(start, [incoming(8, true), incoming(1, true)], 'bob', null).sequence,
  ).toBe(1)
})
test('uses the earliest unread sequence even outside the loaded page', () => {
  expect(updateUnreadBoundary(null, [incoming(100)], 'bob', 1).sequence).toBe(1)
})
test('marks new incoming messages during an open chat and ignores own sends and older history', () => {
  const start = updateUnreadBoundary(null, [incoming(8, true)], 'bob', null)
  const own: Message = { ...incoming(9), from: 'bob' }
  expect(updateUnreadBoundary(start, [own, incoming(1)], 'bob', 1).sequence).toBeNull()
  const next = updateUnreadBoundary(start, [incoming(12), own, incoming(1)], 'bob', 1)
  expect(next.sequence).toBe(12)
  expect(updateUnreadBoundary(next, [incoming(13), incoming(12, true)], 'bob', 13).sequence).toBe(
    12,
  )
})
test('a fresh session uses the remaining unread landmark', () => {
  expect(updateUnreadBoundary(null, [incoming(8)], 'bob', 8).sequence).toBe(8)
  expect(updateUnreadBoundary(null, [incoming(8, true)], 'bob', null).sequence).toBeNull()
})
