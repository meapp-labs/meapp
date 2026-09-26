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
          lastMessagePreview: lastMessage.ciphertext ? undefined : (lastMessage.text ?? ''),
          lastMessageAt: lastMessage.timestamp,
          lastMessageFrom: lastMessage.from,
        }
        if (!lastMessage.from || lastMessage.from === currentUsername) return latest
        return {
          ...latest,
          lastIncomingMessageId: lastMessage.id,
          lastIncomingMessageSequence: lastMessage.sequence,
          lastIncomingMessageEncrypted: Boolean(lastMessage.ciphertext),
          lastIncomingMessagePreview: lastMessage.ciphertext ? undefined : (lastMessage.text ?? ''),
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

export function useSendMessage({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient()

  return useMutation<Message, ApiError, { text: string; clientId: string }, SendMessageContext>({
    retry: (failureCount, error) =>
      failureCount < 1 && (!isApiHttpError(error) || error.status >= 500),
    mutationFn: ({ text, clientId }) => {
      // The key is created before mutation execution, so automatic retries
      // reuse it even if the first response was lost after the server committed.
      return sendE2EMessage(conversationId, text, clientId)
    },
    // Optimistic send: show the message immediately, roll back on failure.
    onMutate: ({ text }): SendMessageContext => {
      const optimistic: Message = {
        id: `pending-${uuid()}`,
        from: useAuthStore.getState().username,
        text,
        type: 'text',
        timestamp: new Date().toISOString(),
      }
      queryClient.setQueryData<MessagesCache>([Keys.Query.GET_MESSAGES, conversationId], (old) =>
        old ? insertIntoCache(old, optimistic) : old,
      )
      return { optimisticId: optimistic.id }
    },
    onError: (_error, _vars, context) => {
      if (!context) return
      queryClient.setQueryData<MessagesCache>([Keys.Query.GET_MESSAGES, conversationId], (old) =>
        old ? removeFromCache(old, context.optimisticId) : old,
      )
    },
    onSuccess: (newMessage, _vars, context) => {
      queryClient.setQueryData<MessagesCache>([Keys.Query.GET_MESSAGES, conversationId], (old) =>
        old
          ? insertIntoCache(context ? removeFromCache(old, context.optimisticId) : old, newMessage)
          : old,
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
  const [readyRoom, setReadyRoom] = useState<string | null>(null)

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
    [string, string],
    { after?: number; before?: number }
  >({
    queryKey: [Keys.Query.GET_MESSAGES, conversationId],
    queryFn: async ({ pageParam }) => {
      const params: {
        conversationId: string
        installId?: string
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

      params.installId = await getE2EInstallId()

      const response = await getFetcher<MessagesResponse>(Keys.Query.GET_MESSAGES, params)
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
      return { ...response, messages }
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
    enabled: !!conversationId && enabled && readyRoom === conversationId,
  }) // Real-time WebSocket with single-use ticket auth + auto-reconnect.
  useWebSocket(
    `${env.EXPO_PUBLIC_API_URL.replace(/^http/, 'ws')}/ws?roomId=${encodeURIComponent(conversationId)}`,
    {
      enabled: enabled && !!conversationId,
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
        if (msg.type === 'authenticated') {
          const key = [Keys.Query.GET_MESSAGES, conversationId]
          const hadData = queryClient.getQueryData(key) !== undefined
          setReadyRoom(conversationId)
          // Reconnects can miss broadcasts; the first auth enables the GET.
          if (hadData) void queryClient.invalidateQueries({ queryKey: key })
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
