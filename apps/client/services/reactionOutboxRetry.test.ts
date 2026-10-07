import { expect, test } from 'bun:test'
import type { ReactionOperation } from '@meapp/shared'
import { pollingInterval } from '../lib/polling'
import { startReactionOutboxRetry } from './reactionOutboxRetry'
import { drainReactionOutbox } from './reactionRetry'

const operation: ReactionOperation = {
  conversationId: crypto.randomUUID(),
  messageId: crypto.randomUUID(),
  installId: crypto.randomUUID(),
  operationId: crypto.randomUUID(),
  predecessor: 0,
  emoji: '👍',
}

test('pending reactions retry with query polling disabled, retaining their operation identity', async () => {
  expect(pollingInterval(true, true, 15_000)).toBe(false)
  let pending = [operation]
  const attempts: ReactionOperation[] = []
  let refreshed = 0
  let sent = () => {}
  const finished = new Promise<void>((resolve) => {
    sent = resolve
  })
  const stop = startReactionOutboxRetry(
    async () => {
      const count = pending.length
      await drainReactionOutbox(
        pending,
        async (entry) => {
          attempts.push(entry)
          if (attempts.length === 1) throw { status: 500 }
        },
        async (entries) => {
          pending = entries
        },
        (error) => (error as { status: number }).status,
      )
      return count
    },
    () => {
      refreshed++
      sent()
    },
    1,
  )
  try {
    await finished
    expect(attempts).toEqual([operation, operation])
    expect(pending).toEqual([])
    expect(refreshed).toBe(1)
    stop()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(refreshed).toBe(1)
  } finally {
    stop()
  }
})

test('stopping an in-flight pass prevents refreshes and future retries', async () => {
  let complete = (_count: number) => {}
  let calls = 0
  let refreshed = 0
  let shouldContinue = () => true
  const stop = startReactionOutboxRetry(
    (check) => {
      shouldContinue = check
      calls++
      return new Promise<number>((resolve) => {
        complete = resolve
      })
    },
    () => {
      refreshed++
    },
    1,
  )
  stop()
  expect(shouldContinue()).toBe(false)
  complete(1)
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(calls).toBe(1)
  expect(refreshed).toBe(0)
})

test('an empty local outbox does not refresh server queries', async () => {
  let refreshed = 0
  const stop = startReactionOutboxRetry(
    async () => 0,
    () => {
      refreshed++
    },
    1,
  )
  try {
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(refreshed).toBe(0)
  } finally {
    stop()
  }
})
