import { usePollingInterval } from '@/lib/polling'
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useWebSocket } from '@/hooks/useWebSocket'
import { type ApiError, getFetcher, isApiHttpError, postFetcher } from '@/lib/api'
import { env } from '@/lib/env'
import { Keys } from '@/lib/keys'
import { useAuthStore } from '@/lib/stores'
import { uuid } from '@/lib/uuid'
import { decryptE2EMessage, getE2EInstallId, sendE2EMessage } from '@/services/e2e'
import type { Conversation, Message, MessagesResponse } from '@meapp/shared'
import { removeCachedAttachment } from './mediaCache'
import { messagePreview } from './messagePreview'
import { syncRoomEnvelopes } from './threadSync'

// Re-export: notification.ts consumes MessagesResponse from this module.
export type { MessagesResponse } from '@meapp/shared'

/** Cache shape for the paginated message list. Pages hold ascending sequences. */
export type MessagesCache = {
  pages: MessagesResponse[]
  pageParams: { after?: number; before?: number }[]
}

/** Inserts a message into page 0 keeping ascending order, deduped. */
function insertIntoCache(old: MessagesCache, message: Message): MessagesCache {
  if (!old.pages[0]) return old

  const exists = old.pages.some((page) =>
    page.messages.some(
      (m) =>
        m.id === message.id ||
        (message.sequence !== undefined && m.sequence === message.sequence) ||
        (message.index !== undefined && m.index === message.index),
    ),
  )
  if (exists) {
    if (!message.text) return old
    const messages = old.pages[0].messages.map((existing) =>
      existing.id === message.id && !existing.text ? message : existing,
    )
    return { ...old, pages: [{ ...old.pages[0], messages }, ...old.pages.slice(1)] }
  }

  return {
    ...old,
    pages: [
      {
        ...old.pages[0],
        messages: [...old.pages[0].messages, message].sort(
          (a, b) =>
            Number(a.sequence ?? a.index ?? Number.MAX_SAFE_INTEGER) -
            Number(b.sequence ?? b.index ?? Number.MAX_SAFE_INTEGER),
        ),
        hasMore: old.pages[0].hasMore,
        totalCount: (old.pages[0].totalCount ?? 0) + 1,
      },
      ...old.pages.slice(1),
    ],
    pageParams: old.pageParams,
  }
}

/** Removes only this send's pending message, preserving concurrent updates. */
function removeFromCache(old: MessagesCache, messageId: string): MessagesCache {
  const firstPage = old.pages[0]
  if (!firstPage) return old

  const messages = firstPage.messages.filter((message) => message.id !== messageId)
  if (messages.length === firstPage.messages.length) return old

  return {
    ...old,
    pages: [
      {
        ...firstPage,
        messages,
        totalCount: Math.max(0, (firstPage.totalCount ?? 0) - 1),
      },
      ...old.pages.slice(1),
    ],
  }
}

/**
 * Update the conversation list cache with a new message preview
 */
function updateConversationListCache(
  queryClient: QueryClient,
  conversationId: string,
  lastMessage: Message,
) {
  const currentUsername = useAuthStore.getState().username
  queryClient.setQueryData<Conversation[]>([Keys.Query.GET_CONVERSATIONS], (old) => {
    if (!old) return old
    return old.map((c: Conversation) => {
      if (c.id === conversationId) {
        const latest = {
          ...c,
          lastMessageEncrypted: Boolean(lastMessage.ciphertext),
          lastMessageId: lastMessage.id,
          lastMessagePreview: lastMessage.ciphertext
            ? undefined
            : (messagePreview(
                lastMessage,
                lastMessage.from === currentUsername ? 'sent' : 'received',
              ) ?? ''),
          lastMessageAt: lastMessage.timestamp,
          lastMessageFrom: lastMessage.from,
        }
        if (!lastMessage.from || lastMessage.from === currentUsername) return latest
        return {
          ...latest,
          lastIncomingMessageId: lastMessage.id,
          lastIncomingMessageSequence: lastMessage.sequence,
          lastIncomingMessageEncrypted: Boolean(lastMessage.ciphertext),
          lastIncomingMessagePreview: lastMessage.ciphertext
            ? undefined
            : (messagePreview(lastMessage, 'received') ?? ''),
          lastIncomingMessageAt: lastMessage.timestamp,
        }
      }
      return c
    })
  })
}

/**
 * Send a message to a conversation
 */
type SendMessageContext = {
  optimisticId: string
}

export const messageQueryKey = (conversationId: string, threadRootId?: string) =>
  threadRootId
    ? [Keys.Query.GET_MESSAGES, conversationId, threadRootId]
    : [Keys.Query.GET_MESSAGES, conversationId]

export function useSendMessage({
  conversationId,
  threadRootId,
}: { conversationId: string; threadRootId?: string | undefined }) {
  const queryClient = useQueryClient()

  return useMutation<
    Message,
    ApiError,
    { text: string; clientId: string; replyTo?: string | undefined },
    SendMessageContext
  >({
    retry: (failureCount, error) =>
      failureCount < 1 && (!isApiHttpError(error) || error.status >= 500),
    mutationFn: ({ text, clientId, replyTo }) => {
      // The key is created before mutation execution, so automatic retries
      // reuse it even if the first response was lost after the server committed.
      return sendE2EMessage(conversationId, text, clientId, [], replyTo, threadRootId)
    },
    // Optimistic send: show the message immediately, roll back on failure.
    onMutate: ({ text, replyTo }): SendMessageContext => {
      const optimistic: Message = {
        id: `pending-${uuid()}`,
        from: useAuthStore.getState().username,
        text,
        ...(replyTo ? { replyTo } : {}),
        ...(threadRootId ? { threadRootId } : {}),
        type: 'text',
        timestamp: new Date().toISOString(),
      }
      queryClient.setQueryData<MessagesCache>(
        messageQueryKey(conversationId, threadRootId),
        (old) => (old ? insertIntoCache(old, optimistic) : old),
      )
      return { optimisticId: optimistic.id }
    },
    onError: (_error, _vars, context) => {
      if (!context) return
      queryClient.setQueryData<MessagesCache>(
        messageQueryKey(conversationId, threadRootId),
        (old) => (old ? removeFromCache(old, context.optimisticId) : old),
      )
    },
    onSuccess: (newMessage, _vars, context) => {
      queryClient.setQueryData<MessagesCache>(
        messageQueryKey(conversationId, threadRootId),
        (old) =>
          old
            ? insertIntoCache(
                context ? removeFromCache(old, context.optimisticId) : old,
                newMessage,
              )
            : old,
      )
      updateConversationListCache(queryClient, conversationId, newMessage)
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_MESSAGES, conversationId] })
    },
  })
}

/**
 * Get messages for a conversation with infinite scroll
 * Uses WebSocket subscription for real-time messages instead of polling
 */
export function useGetMessages({
  conversationId,
  enabled = true,
  threadRootId,
}: {
  conversationId: string
  enabled?: boolean
  threadRootId?: string | undefined
}) {
  const queryClient = useQueryClient()
  const [readyRoom, setReadyRoom] = useState<string | null>(null)
  const pollInterval = usePollingInterval(30_000, conversationId)

  // Fall back to loading history when the socket cannot authenticate.
  useEffect(() => {
    if (!enabled || !conversationId) return
    const timer = setTimeout(() => setReadyRoom(conversationId), 3000)
    return () => clearTimeout(timer)
  }, [conversationId, enabled])

  const query = useInfiniteQuery<
    MessagesResponse,
    ApiError,
    {
      pages: MessagesResponse[]
      pageParams: { after?: number; before?: number }[]
    },
    readonly string[],
    { after?: number; before?: number }
  >({
    queryKey: messageQueryKey(conversationId, threadRootId),
    refetchInterval: pollInterval,
    queryFn: async ({ pageParam }) => {
      const params: {
        conversationId: string
        installId?: string
        threadRootId?: string
        limit: string
        after?: string
        before?: string
      } = {
        conversationId,
        limit: '16',
        ...(threadRootId ? { threadRootId } : {}),
      }

      if (pageParam.after !== undefined) {
        params.after = pageParam.after.toString()
      } else if (pageParam.before !== undefined) {
        params.before = pageParam.before.toString()
      }

      params.installId = await getE2EInstallId()
      await syncRoomEnvelopes(conversationId)

      const response = await getFetcher<MessagesResponse>(Keys.Query.GET_MESSAGES, params)
      const threadRoot = response.threadRoot
        ? await decryptE2EMessage(response.threadRoot).catch(() => response.threadRoot)
        : undefined
      const messages: Message[] = []
      // Ratchet state is sequential. Never decrypt one page concurrently.
      for (const message of response.messages) {
        try {
          messages.push(await decryptE2EMessage(message))
        } catch (error) {
          console.error('[E2E] Message decryption failed:', error)
          messages.push({ ...message, type: 'undecryptable' })
        }
      }
      return { ...response, messages, ...(threadRoot ? { threadRoot } : {}) }
    },
    initialPageParam: {},
    getNextPageParam: (lastPage) => {
      // Each page is ascending, so its first message is the oldest cursor.
      if (lastPage.hasMore && lastPage.messages.length > 0) {
        const oldestMessage = lastPage.messages[0]
        const sequence = oldestMessage?.sequence ?? oldestMessage?.index
        if (sequence !== undefined) {
          return { before: Number(sequence) }
        }
      }
      return undefined
    },
    enabled: !!conversationId && enabled && (Boolean(threadRootId) || readyRoom === conversationId),
  }) // Real-time WebSocket with single-use ticket auth + auto-reconnect.
  useWebSocket(
    `${env.EXPO_PUBLIC_API_URL.replace(/^http/, 'ws')}/ws?roomId=${encodeURIComponent(conversationId)}`,
    {
      enabled: enabled && !!conversationId && !threadRootId,
      roomId: conversationId,
      getAuthMessage: async (signal) => {
        const res = await postFetcher<{ ticket?: string }>(
          '/ws/ticket',
          {
            roomId: conversationId,
          },
          { signal },
        )
        if (!res.ticket) throw new Error('WebSocket ticket missing')
        return JSON.stringify({ type: 'auth', payload: { ticket: res.ticket } })
      },
      onMessage: (data) => {
        const msg = data as { type?: string; payload?: Record<string, unknown> }
        if (msg.type === 'media-deleted' && msg.payload?.roomId === conversationId) {
          if (typeof msg.payload.attachmentId === 'string')
            void removeCachedAttachment(msg.payload.attachmentId)
          void queryClient.invalidateQueries({
            queryKey: [Keys.Query.GET_MESSAGES, conversationId],
          })
          return
        }
        if (msg.type === 'thread-changed' && msg.payload?.roomId === conversationId) {
          void queryClient.invalidateQueries({
            queryKey: [Keys.Query.GET_MESSAGES, conversationId],
          })
          void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
          return
        }
        if (msg.type === 'reactions-changed' && msg.payload?.roomId === conversationId) {
          void queryClient.invalidateQueries({ queryKey: ['reactions', conversationId] })
          return
        }
        if (msg.type === 'authenticated') {
          void queryClient.invalidateQueries({ queryKey: ['reactions', conversationId] })
          const key = [Keys.Query.GET_MESSAGES, conversationId]
          const hadData = queryClient.getQueryData(key) !== undefined
          setReadyRoom(conversationId)
          // Reconnects can miss broadcasts; the first auth enables the GET.
          if (hadData) void queryClient.invalidateQueries({ queryKey: key })
          void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
          return
        }
        if (msg.type !== 'message' || !msg.payload) return

        const p = msg.payload as {
          id?: string
          roomId?: string
          from?: string
          userId?: string
          sequence?: number
          text?: string
          ciphertext?: string
          ciphertextType?: number
          fromDeviceId?: string
          createdAt?: string
        }
        if (p.roomId !== conversationId || !p.id || p.sequence === undefined) return

        void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })

        if (p.ciphertext) {
          // Broadcasts contain only an opaque marker. Fetch the envelope
          // addressed to this device, then decrypt it in sequence order.
          void queryClient.invalidateQueries({
            queryKey: [Keys.Query.GET_MESSAGES, conversationId],
          })
          return
        }

        const incomingMessage: Message = {
          id: p.id,
          index: p.sequence,
          sequence: p.sequence,
          from: p.from ?? p.userId,
          ...(p.ciphertext
            ? {
                ciphertext: p.ciphertext,
                ciphertextType: p.ciphertextType,
                fromDeviceId: p.fromDeviceId,
              }
            : { text: p.text ?? '' }),
          type: 'text',
          timestamp: p.createdAt ?? new Date().toISOString(),
        }

        queryClient.setQueryData<MessagesCache>([Keys.Query.GET_MESSAGES, conversationId], (old) =>
          old ? insertIntoCache(old, incomingMessage) : old,
        )

        updateConversationListCache(queryClient, conversationId, incomingMessage)
      },
    },
  )

  return query
}
