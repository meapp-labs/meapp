import { expect, test } from 'bun:test'
import { createJournalRepository } from './journalRepository'
test('journal rejects stale edits, cross-account data and oversized entries while preserving saved text', async () => {
  let raw: string | null = null
  let pending: Promise<unknown> = Promise.resolve()
  const port = {
    read: async () => raw,
    write: async (value: string) => {
      raw = value
    },
    lock<T>(work: () => Promise<T>): Promise<T> {
      const result = pending.then(work)
      pending = result.catch(() => undefined)
      return result
    },
  }
  const repo = createJournalRepository('owner', port)
  const first = await repo.save(0, 'Private note')
  const results = await Promise.allSettled([
    repo.save(first.revision, 'Edited', first.entries[0]?.id),
    repo.save(first.revision, 'Stale'),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect((await repo.read()).entries[0]?.text).toBe('Edited')
  await expect(createJournalRepository('other', port).read()).rejects.toThrow('another account')
  await expect(repo.save(2, 'x'.repeat(10001))).rejects.toThrow()
  expect((await repo.read()).entries).toHaveLength(1)
  expect((await repo.remove(2, first.entries[0]?.id ?? '')).entries).toHaveLength(0)
})
