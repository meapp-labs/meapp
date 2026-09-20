import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { type ApiError, getFetcher, postFetcher } from '@/lib/api'
import { env } from '@/lib/env'
import { Keys } from '@/lib/keys'
import { useAuthStore } from '@/lib/stores'
import type { Conversation, Message, MessagesResponse, SendMessageRequest } from '@/types/models'

// Re-export for backwards compatibility
export type { MessagesResponse } from '@/types/models'

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
  const token = useAuthStore((s) => s.token)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      if (lastPage.hasMore && lastPage.messages.length > 0) {
        const firstMessage = lastPage.messages[0]
        const sequence = firstMessage?.sequence ?? firstMessage?.index
        if (sequence !== undefined) {
          return { before: Number(sequence) }
        }
      }
      return undefined
    },
    enabled: !!conversationId && enabled,
  })

  // Real-time WebSocket subscription
  useEffect(() => {
    if (!enabled || !conversationId) return

    let isSubscribed = true

    const connectWebSocket = () => {
      if (!isSubscribed) return

      try {
        const baseWsUrl = env.EXPO_PUBLIC_API_URL.replace(/^http/, 'ws')
        const wsUrl = `${baseWsUrl}/ws?roomId=${encodeURIComponent(conversationId)}`
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          if (!isSubscribed) {
            ws.close()
            return
          }
          if (token) {
            ws.send(JSON.stringify({ type: 'auth', payload: { token } }))
          }
        }

        ws.onmessage = (event) => {
          if (!isSubscribed) return
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'message' && data.payload) {
              const p = data.payload
              if (p.roomId === conversationId) {
                const incomingMessage: Message = {
                  id: p.id,
                  index: p.sequence,
                  sequence: p.sequence,
                  from: p.userId,
                  text: p.text,
                  type: 'text',
                  timestamp: p.createdAt || new Date().toISOString(),
                }

                queryClient.setQueryData<{
                  pages: MessagesResponse[]
                  pageParams: { after?: number; before?: number }[]
                }>([Keys.Query.GET_MESSAGES, conversationId], (old) => {
                  if (!old || !old.pages[0]) return old

                  const alreadyExists = old.pages[0].messages.some(
                    (m) =>
                      m.id === incomingMessage.id ||
                      (incomingMessage.sequence && m.sequence === incomingMessage.sequence) ||
                      (incomingMessage.index && m.index === incomingMessage.index),
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
              }
            }
          } catch (e) {
            console.error('[WebSocket] Failed to parse message:', e)
          }
        }

        ws.onclose = () => {
          if (!isSubscribed) return
          reconnectTimerRef.current = setTimeout(() => {
            connectWebSocket()
          }, 3000)
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch (err) {
        console.error('[WebSocket] Connection error:', err)
      }
    }

    connectWebSocket()

    return () => {
      isSubscribed = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [conversationId, enabled, token, queryClient])

  return query
}
