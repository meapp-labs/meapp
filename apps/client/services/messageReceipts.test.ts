import { describe, expect, test } from 'bun:test'
import type { Message } from '@meapp/shared'
import { canAcknowledgeMessage, receiptForeground } from './messageReceipts'

const received: Message = {
  id: crypto.randomUUID(),
  sequence: 42,
  from: 'alice',
  text: 'Hello',
  type: 'text',
}

describe('receipt eligibility', () => {
  test('does not read on background, hidden browser tabs, or unfocused windows', () => {
    expect(receiptForeground('active')).toBe(true)
    expect(receiptForeground('background')).toBe(false)
    expect(receiptForeground('inactive')).toBe(false)
    expect(receiptForeground('active', 'hidden')).toBe(false)
    expect(receiptForeground('active', 'visible', false)).toBe(false)
  })
  test('only acknowledges successfully processed incoming messages', () => {
    expect(canAcknowledgeMessage(received, 'bob')).toBe(true)
    expect(canAcknowledgeMessage(received, 'alice')).toBe(false)
    expect(canAcknowledgeMessage({ ...received, sequence: undefined }, 'bob')).toBe(false)
    expect(
      canAcknowledgeMessage({ ...received, text: undefined, ciphertext: 'opaque' }, 'bob'),
    ).toBe(false)
    expect(canAcknowledgeMessage({ ...received, type: 'undecryptable' }, 'bob')).toBe(false)
  })
})
