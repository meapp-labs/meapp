import { getFetcher } from '@/lib/api'
import type { MessagesResponse } from '@meapp/shared'
import { decryptE2EMessage, getE2EContext } from './e2e'
import { getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata'
import { type RoomSyncCursor, synchronizeRoomStream } from './threadStream'

const running = new Map<string, Promise<void>>()

/** Synchronize the durable room stream before opening independently paginated views.
 * This prevents a busy hidden thread from leaving a device's Signal ratchet behind.
 */
export async function syncRoomEnvelopes(conversationId: string) {
  const context = await getE2EContext()
  const scope = `${context.userId}:${context.installId}:${conversationId}`
  const existing = running.get(scope)
  if (existing) return existing
  const task = (async () => {
    const key = `meapp:e2e:room-sync:v1:${conversationId}`
    const raw = await getPrivateMetadata(context.storage, key)
    const saved = raw ? (JSON.parse(raw) as RoomSyncCursor) : null
    await synchronizeRoomStream(saved, {
      fetchPage: (after, audience) =>
        getFetcher<MessagesResponse>('get-messages', {
          conversationId,
          installId: context.installId,
          after: String(after),
          limit: '100',
          ...(audience ? { syncAudience: audience } : {}),
        }),
      decrypt: decryptE2EMessage,
      onFailure: (error) =>
        console.warn('[E2E] Room synchronization will retry an envelope:', error),
      save: (cursor) => setPrivateMetadata(context.storage, key, JSON.stringify(cursor)),
    })
  })()
  running.set(scope, task)
  try {
    await task
  } finally {
    running.delete(scope)
  }
}
