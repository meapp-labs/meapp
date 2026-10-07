import { type Journal, journalEntrySchema, journalSchema } from '@meapp/shared'
import { uuid } from '../lib/uuid'
export function createJournalRepository(
  accountId: string,
  port: {
    read(): Promise<string | null>
    write(value: string): Promise<void>
    lock<T>(work: () => Promise<T>): Promise<T>
  },
) {
  async function read(): Promise<Journal> {
    const raw = await port.read()
    const value =
      raw === null
        ? { version: 1 as const, accountId, revision: 0, entries: [] }
        : journalSchema.parse(JSON.parse(raw))
    if (value.accountId !== accountId) throw new Error('Journal belongs to another account')
    return value
  }
  const update = (revision: number, work: (journal: Journal) => void) =>
    port.lock(async () => {
      const journal = await read()
      if (journal.revision !== revision)
        throw new Error('Journal changed in another window. Reload before saving.')
      work(journal)
      journal.revision++
      const value = journalSchema.parse(journal)
      await port.write(JSON.stringify(value))
      return value
    })
  return {
    read,
    save: (revision: number, text: string, id?: string) =>
      update(revision, (journal) => {
        const existing = id ? journal.entries.find((entry) => entry.id === id) : undefined
        if (id && !existing) throw new Error('Entry no longer exists')
        const entry = journalEntrySchema.parse({
          id: id ?? uuid(),
          text,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        })
        if (existing)
          journal.entries = journal.entries.map((item) => (item.id === entry.id ? entry : item))
        else journal.entries.unshift(entry)
      }),
    remove: (revision: number, id: string) =>
      update(revision, (journal) => {
        journal.entries = journal.entries.filter((entry) => entry.id !== id)
      }),
  }
}
