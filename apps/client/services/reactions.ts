import { getFetcher, isApiHttpError, postFetcher } from '@/lib/api'
import { usePollingInterval, useRealtimeStore } from '@/lib/polling'
import { useAuthStore } from '@/lib/stores'
import { uuid } from '@/lib/uuid'
import { type ReactionOperation, type ReactionSync, reactionOperationSchema } from '@meapp/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getE2EContext } from './e2e'
import { getPrivateMetadata, setPrivateMetadata } from './e2ePrivateMetadata'
import { startReactionOutboxRetry } from './reactionOutboxRetry'
import { drainReactionOutbox } from './reactionRetry'
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

async function flush(roomId: string, operation?: ReactionOperation, shouldContinue = () => true) {
  return withQueue(async () => {
    if (!shouldContinue()) return 0
    const { storage, username, installId } = await getE2EContext()
    if (!shouldContinue()) return 0
    const key = `meapp:reactions:outbox:v1:${roomId}`
    const raw = await getPrivateMetadata(storage, key)
    const pending = raw ? reactionOperationSchema.array().parse(JSON.parse(raw)) : []
    if (operation && !pending.some((entry) => entry.operationId === operation.operationId)) {
      pending.push(operation)
      await setPrivateMetadata(storage, key, JSON.stringify(pending))
    }
    await drainReactionOutbox(
      pending,
      async (entry) => {
        if (!shouldContinue()) throw new Error('Reaction retry paused')
        if (useAuthStore.getState().username !== username)
          throw new Error('Account changed; retry after signing in')
        // Recovery changes only the authentication binding, preserving operation identity.
        return postFetcher('reactions', { ...entry, installId })
      },
      (remaining) => setPrivateMetadata(storage, key, JSON.stringify(remaining)),
      (error) => (isApiHttpError(error) ? error.status : undefined),
    )
    return pending.length
  })
}

export function useReactions(conversationId: string) {
  const pollInterval = usePollingInterval(15_000, conversationId)
  const active = useRealtimeStore((state) => state.active)
  const username = useAuthStore((state) => state.username)
  const client = useQueryClient()
  const key = ['reactions', conversationId] as const
  useEffect(() => {
    if (!active || !username || !conversationId) return
    return startReactionOutboxRetry(
      (shouldContinue) =>
        flush(
          conversationId,
          undefined,
          () =>
            shouldContinue() &&
            useRealtimeStore.getState().active &&
            useAuthStore.getState().username === username,
        ),
      () => {
        void client.invalidateQueries({ queryKey: ['reactions', conversationId] })
      },
    )
  }, [active, username, conversationId, client])
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { installId } = await getE2EContext()
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
    refetchInterval: pollInterval,
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
