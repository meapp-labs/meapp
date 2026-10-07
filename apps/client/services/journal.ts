import { getFetcher } from '@/lib/api'
import { Platform } from 'react-native'
import { getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata'
import { getE2EStore } from './e2eStore'
import { createJournalRepository } from './journalRepository'
let pending: Promise<unknown> = Promise.resolve()
export async function openJournal() {
  const me = await getFetcher<{ id: string }>('me')
  const storage = await getE2EStore(me.id)
  const key = 'meapp:journal:v1'
  return createJournalRepository(me.id, {
    read: () => getPrivateMetadata(storage, key),
    write: (value) => setPrivateMetadata(storage, key, value),
    lock<T>(work: () => Promise<T>): Promise<T> {
      const locked = async (): Promise<T> => {
        if (Platform.OS === 'web') {
          if (!navigator.locks) throw new Error('Journal editing requires Web Locks support')
          // A restore rotates private metadata encryption; do not write with an old key.
          return await navigator.locks.request(`meapp:recovery:${me.id}`, work)
        }
        return work()
      }
      const result = pending.catch(() => undefined).then(locked)
      pending = result
      return result
    },
  })
}
