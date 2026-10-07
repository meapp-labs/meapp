import { expect, test } from 'bun:test'
import type { Message } from '@meapp/shared'
import { visibleMessages } from './threadPresentation'

const root: Message = { id: 'root', sequence: 1, text: 'Original', type: 'text' }
const reply: Message = {
  id: 'reply',
  sequence: 3,
  text: 'Reply',
  threadRootId: 'root',
  type: 'text',
}
const nestedQuote: Message = {
  id: 'quote',
  sequence: 5,
  text: 'Answer',
  threadRootId: 'root',
  replyTo: 'reply',
  type: 'text',
}
const other: Message = { id: 'other', sequence: 4, text: 'Main chat', type: 'text' }
test('main timeline hides thread replies while retaining original room order', () => {
  expect(visibleMessages([root, reply, other, nestedQuote]).map((message) => message.id)).toEqual([
    'other',
    'root',
  ])
})
test('thread replies remain flat and quotes do not create nested discussions', () => {
  expect(
    visibleMessages([reply, other, nestedQuote], 'root', root).map((message) => message.id),
  ).toEqual(['quote', 'reply', 'root'])
})
test('root is included once across paginated history and pending replies stay at the bottom', () => {
  const pending: Message = { id: 'pending', text: 'Sending', threadRootId: 'root', type: 'text' }
  expect(
    visibleMessages([reply, root, reply, pending], 'root', root).map((message) => message.id),
  ).toEqual(['pending', 'reply', 'root'])
})
