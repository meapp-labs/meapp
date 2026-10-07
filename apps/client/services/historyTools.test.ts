import { expect, test } from 'bun:test'
import type { Message } from '@meapp/shared'
import { searchHistory } from './historyTools'
test('local search normalizes text, removes duplicate pages and excludes unavailable ciphertext', () => {
  const first: Message = { id: 'one', type: 'text', text: 'Hello ＷＯＲＬＤ', sequence: 1 }
  const hidden: Message = { id: 'hidden', type: 'undecryptable', ciphertext: 'world', sequence: 2 }
  expect(searchHistory([first, first, hidden], 'world').map((message) => message.id)).toEqual([
    'one',
  ])
  expect(searchHistory([first], '', true)).toEqual([])
})
