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
import type { Conversation, Message, MessagesResponse, SendMessageRequest } from '@meapp/shared'

// Re-export for backwards compatibility
export type { MessagesResponse } from '@meapp/shared'

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
export function useSendMessage({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient()

  return useMutation<Message, ApiError, { text: string }>({
    mutationFn: ({ text }) =>
      postFetcher<Message, SendMessageRequest>(Keys.Mutation.SEND_MESSAGE, {
        conversationId,
        text,
      }),
    onSuccess: (newMessage) => {
      // Add the new message to the messages cache
      queryClient.setQueryData<{
        pages: MessagesResponse[]
        pageParams: { after?: number; before?: number }[]
      }>([Keys.Query.GET_MESSAGES, conversationId], (old) => {
        if (!old || !old.pages[0]) return old

        const exists = old.pages[0].messages.some(
          (m) =>
            m.id === newMessage.id ||
            (newMessage.sequence && m.sequence === newMessage.sequence) ||
            (newMessage.index && m.index === newMessage.index),
        )
        if (exists) return old

        const updatedMessages = [...old.pages[0].messages, newMessage]

        return {
          ...old,
          pages: [
            {
              messages: updatedMessages,
              hasMore: old.pages[0].hasMore,
              totalCount: (old.pages[0].totalCount ?? 0) + 1,
            },
            ...old.pages.slice(1),
          ],
          pageParams: old.pageParams,
        }
      })

      // Update conversation list cache to sync preview
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

        queryClient.setQueryData<{
          pages: MessagesResponse[]
          pageParams: { after?: number; before?: number }[]
        }>([Keys.Query.GET_MESSAGES, conversationId], (old) => {
          if (!old || !old.pages[0]) return old

          const alreadyExists = old.pages[0].messages.some(
            (m) =>
              m.id === incomingMessage.id ||
              (incomingMessage.sequence !== undefined && m.sequence === incomingMessage.sequence) ||
              (incomingMessage.index !== undefined && m.index === incomingMessage.index),
          )
          if (alreadyExists) return old

          return {
            ...old,
            pages: [
              {
                messages: [...old.pages[0].messages, incomingMessage],
                hasMore: old.pages[0].hasMore,
                totalCount: (old.pages[0].totalCount ?? 0) + 1,
              },
              ...old.pages.slice(1),
            ],
            pageParams: old.pageParams,
          }
        })

        updateConversationListCache(queryClient, conversationId, incomingMessage)
      },
    },
  )

  return query
}
