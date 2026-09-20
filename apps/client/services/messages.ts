import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import { useWebSocket } from '@/hooks/useWebSocket'
import { type ApiError, getFetcher, postFetcher } from '@/lib/api'
import { env } from '@/lib/env'
import { Keys } from '@/lib/keys'
import { useAuthStore } from '@/lib/stores'
import type { Conversation, Message, MessagesResponse, SendMessageRequest } from '@meapp/shared'

// Re-export: notification.ts consumes MessagesResponse from this module.
export type { MessagesResponse } from '@meapp/shared'

/** Cache shape for the paginated message list. Pages hold ascending sequences. */
type MessagesCache = {
  pages: MessagesResponse[]
  pageParams: { after?: number; before?: number }[]
}

/** Inserts a message into page 0 keeping ascending order, deduped. */
function insertIntoCache(old: MessagesCache, message: Message): MessagesCache {
  if (!old.pages[0]) return old

  const exists = old.pages[0].messages.some(
    (m) =>
      m.id === message.id ||
      (message.sequence !== undefined && m.sequence === message.sequence) ||
      (message.index !== undefined && m.index === message.index),
  )
  if (exists) return old

  return {
    ...old,
    pages: [
      {
        messages: [...old.pages[0].messages, message],
        hasMore: old.pages[0].hasMore,
        totalCount: (old.pages[0].totalCount ?? 0) + 1,
      },
      ...old.pages.slice(1),
    ],
    pageParams: old.pageParams,
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
  queryClient.setQueryData<Conversation[]>([Keys.Query.GET_CONVERSATIONS], (old) => {
    if (!old) return old
    return old.map((c: Conversation) => {
      if (c.id === conversationId) {
        return {
          ...c,
          lastMessagePreview: lastMessage.text,
          lastMessageAt: lastMessage.timestamp,
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
  previous: MessagesCache | undefined
  optimisticId: string
}

export function useSendMessage({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient()

  return useMutation<Message, ApiError, { text: string }, SendMessageContext>({
    mutationFn: ({ text }) => {
      // Idempotency key: server dedupes on (userId, clientId), so retries and
      // double-taps never duplicate messages or burn sequences.
      const clientId = Bun.randomUUIDv7()
      return postFetcher<Message, SendMessageRequest>(Keys.Mutation.SEND_MESSAGE, {
        conversationId,
        text,
        clientId,
      })
    },
    // Optimistic send: show the message immediately, roll back on failure.
    onMutate: async ({ text }): Promise<SendMessageContext> => {
      const optimistic: Message = {
        id: `pending-${Date.now()}`,
        from: useAuthStore.getState().username,
        text,
        type: 'text',
        timestamp: new Date().toISOString(),
      }
      const previous = queryClient.getQueryData<MessagesCache>([
        Keys.Query.GET_MESSAGES,
        conversationId,
      ])
      queryClient.setQueryData<MessagesCache>([Keys.Query.GET_MESSAGES, conversationId], (old) =>
        old ? insertIntoCache(old, optimistic) : old,
      )
      return { previous, optimisticId: optimistic.id }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData<MessagesCache>(
          [Keys.Query.GET_MESSAGES, conversationId],
          context.previous,
        )
      }
    },
    onSuccess: (newMessage) => {
      queryClient.setQueryData<MessagesCache>([Keys.Query.GET_MESSAGES, conversationId], (old) =>
        old ? insertIntoCache(old, newMessage) : old,
      )
      updateConversationListCache(queryClient, conversationId, newMessage)
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
}: {
  conversationId: string
  enabled?: boolean
}) {
  const queryClient = useQueryClient()

  const query = useInfiniteQuery<
    MessagesResponse,
    ApiError,
    {
      pages: MessagesResponse[]
      pageParams: { after?: number; before?: number }[]
    },
    [string, string],
    { after?: number; before?: number }
  >({
    queryKey: [Keys.Query.GET_MESSAGES, conversationId],
    queryFn: async ({ pageParam }) => {
      const params: {
        conversationId: string
        limit: string
        after?: string
        before?: string
      } = {
        conversationId,
        limit: '16',
      }

      if (pageParam.after !== undefined) {
        params.after = pageParam.after.toString()
      } else if (pageParam.before !== undefined) {
        params.before = pageParam.before.toString()
      }

      return getFetcher<MessagesResponse>(Keys.Query.GET_MESSAGES, params)
    },
    initialPageParam: {},
    getNextPageParam: (lastPage) => {
      // List is stored newest-first, so the cursor is the LAST message.
      if (lastPage.hasMore && lastPage.messages.length > 0) {
        const oldestMessage = lastPage.messages[lastPage.messages.length - 1]
        const sequence = oldestMessage?.sequence ?? oldestMessage?.index
        if (sequence !== undefined) {
          return { before: Number(sequence) }
        }
      }
      return undefined
    },
    enabled: !!conversationId && enabled,
  }) // Real-time WebSocket with single-use ticket auth + auto-reconnect.
  useWebSocket(
    `${env.EXPO_PUBLIC_API_URL.replace(/^http/, 'ws')}/ws?roomId=${encodeURIComponent(conversationId)}`,
    {
      enabled: enabled && !!conversationId,
      onOpen: (send) => {
        void postFetcher<{ ticket?: string }>('/ws/ticket', { roomId: conversationId })
          .then((res) => {
            if (res.ticket) {
              send(JSON.stringify({ type: 'auth', payload: { ticket: res.ticket } }))
            }
          })
          .catch((e) => {
            console.warn('[WebSocket] Could not obtain ticket:', e)
          })
      },
      onMessage: (data) => {
        const msg = data as { type?: string; payload?: Record<string, unknown> }
        if (msg.type !== 'message' || !msg.payload) return

        const p = msg.payload as {
          id?: string
          roomId?: string
          from?: string
          userId?: string
          sequence?: number
          text?: string
          createdAt?: string
        }
        if (p.roomId !== conversationId || !p.id || p.sequence === undefined) return

        const incomingMessage: Message = {
          id: p.id,
          index: p.sequence,
          sequence: p.sequence,
          from: p.from ?? p.userId,
          text: p.text ?? '',
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
