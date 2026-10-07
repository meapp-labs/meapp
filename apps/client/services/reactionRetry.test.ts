import { expect, test } from 'bun:test'
import type { ReactionOperation } from '@meapp/shared'
import { drainReactionOutbox } from './reactionRetry'

const operation: ReactionOperation = {
  conversationId: crypto.randomUUID(),
  messageId: crypto.randomUUID(),
  installId: crypto.randomUUID(),
  operationId: crypto.randomUUID(),
  predecessor: 4,
  emoji: '👍',
}
for (const status of [401, 408, 425, 429, 500]) {
  test(`reaction retry retains operation through HTTP ${status}`, async () => {
    let saved = [operation]
    const attempts: ReactionOperation[] = []
    let fail = true
    const send = async (entry: ReactionOperation) => {
      attempts.push(entry)
      if (fail) throw { status }
    }
    const persist = async (entries: ReactionOperation[]) => {
      saved = entries
    }
    const statusOf = (error: unknown) => (error as { status: number }).status
    await expect(drainReactionOutbox(saved, send, persist, statusOf)).rejects.toEqual({ status })
    expect(saved).toEqual([operation])
    fail = false
    await drainReactionOutbox(saved, send, persist, statusOf)
    expect(attempts).toEqual([operation, operation])
    expect(saved).toEqual([])
  })
}
test('conflicts remove only the rejected operation, preserving later queued work', async () => {
  const next = { ...operation, operationId: crypto.randomUUID() }
  let saved = [operation, next]
  await expect(
    drainReactionOutbox(
      saved,
      async () => {
        throw { status: 409 }
      },
      async (entries) => {
        saved = entries
      },
      (error) => (error as { status: number }).status,
    ),
  ).rejects.toEqual({ status: 409 })
  expect(saved).toEqual([next])
})
