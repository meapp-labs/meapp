import { expect, test } from 'bun:test'
import type { ReactionEntry } from '@meapp/shared'
import { mergeReactions } from './reactionState'

const entry = (
  revision: number,
  emoji: ReactionEntry['emoji'],
  userId = 'alice',
): ReactionEntry => ({ messageId: 'message', userId, username: userId, revision, emoji })
test('out-of-order replay cannot resurrect removed reactions', () => {
  const removed = entry(3, null)
  expect(mergeReactions([removed], [entry(2, '🔥'), entry(1, '❤️'), removed])).toEqual([removed])
})
test('offline catch-up and incremental pages converge independently per author', () => {
  const events = [entry(1, '❤️'), entry(2, '👍', 'bob'), entry(3, '🔥'), entry(4, null)]
  const all = mergeReactions([], events)
  const paged = mergeReactions(mergeReactions([], events.slice(0, 2)), events.slice(2))
  expect(paged).toEqual(all)
  expect(all).toEqual([entry(4, null), entry(2, '👍', 'bob')])
  expect(mergeReactions(all, events)).toEqual(all)
})
