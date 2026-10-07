import { getFetcher, isApiHttpError, postFetcher } from '@/lib/api'
import { uuid } from '@/lib/uuid'
import { type ReactionOperation, type ReactionSync, reactionOperationSchema } from '@meapp/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getE2EContext } from './e2e'
import { getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata'
import { mergeReactions } from './reactionState'

let queue = Promise.resolve()
async function withQueue<T>(action: () => Promise<T>): Promise<T> {
  const previous = queue
  let release = () => {}
  queue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await action()
  } finally {
    release()
  }
}

async function flush(roomId: string, operation?: ReactionOperation) {
  return withQueue(async () => {
    const { storage } = await getE2EContext()
    const key = `meapp:reactions:outbox:v1:${roomId}`
    const raw = await getPrivateMetadata(storage, key)
    let pending = raw ? reactionOperationSchema.array().parse(JSON.parse(raw)) : []
    if (operation && !pending.some((entry) => entry.operationId === operation.operationId)) {
      pending.push(operation)
      await setPrivateMetadata(storage, key, JSON.stringify(pending))
    }
    for (const entry of [...pending]) {
      try {
        await postFetcher('reactions', entry)
      } catch (error) {
        // Conflicts are terminal. Network failures keep the exact operation for retry.
        if (isApiHttpError(error) && error.status >= 400 && error.status < 500) {
          pending = pending.filter((item) => item.operationId !== entry.operationId)
          await setPrivateMetadata(storage, key, JSON.stringify(pending))
        }
        throw error
      }
      pending = pending.filter((item) => item.operationId !== entry.operationId)
      await setPrivateMetadata(storage, key, JSON.stringify(pending))
    }
  })
}

export function useReactions(conversationId: string) {
  const client = useQueryClient()
  const key = ['reactions', conversationId] as const
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { installId } = await getE2EContext()
      // Pending offline operations are retried on reconnect, focus, and polling.
      await flush(conversationId).catch(() => undefined)
      const previous = client.getQueryData<ReactionSync>(key)
      let entries = previous?.entries ?? []
      let cursor = previous?.cursor ?? 0
      let audience = previous?.audienceVersion
      let page: ReactionSync
      do {
        page = await getFetcher<ReactionSync>('reactions', {
          conversationId,
          installId,
          after: String(cursor),
          ...(audience ? { audience } : {}),
        })
        if (audience && audience !== page.audienceVersion) entries = []
        audience = page.audienceVersion
        entries = mergeReactions(entries, page.entries)
        cursor = page.cursor
      } while (page.hasMore)
      return { entries, cursor, hasMore: false, audienceVersion: audience }
    },
    enabled: Boolean(conversationId),
    refetchInterval: 15000,
  })
  const mutation = useMutation({
    mutationFn: async ({
      messageId,
      emoji,
    }: { messageId: string; emoji: ReactionOperation['emoji'] }) => {
      const { userId, installId } = await getE2EContext()
      const own = query.data?.entries.find(
        (entry) => entry.messageId === messageId && entry.userId === userId,
      )
      await flush(conversationId, {
        conversationId,
        messageId,
        emoji,
        installId,
        operationId: uuid(),
        predecessor: own?.revision ?? 0,
      })
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })
  return { ...query, react: mutation.mutateAsync, pending: mutation.isPending }
}
