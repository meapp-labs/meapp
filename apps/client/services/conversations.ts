import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { type ApiError, getFetcher, postFetcher } from '@/lib/api'
import { Keys } from '@/lib/keys'
import { useConversationStore } from '@/lib/stores'
import { decryptE2EMessage, getE2EInstallId } from '@/services/e2e'
import type { Conversation, CreateConversationInput, MessagesResponse } from '@meapp/shared'

/**
 * Create or get existing conversation
 */
export function useCreateConversation() {
  const queryClient = useQueryClient()

  return useMutation<Conversation, ApiError, CreateConversationInput>({
    mutationFn: (data) =>
      postFetcher<Conversation, CreateConversationInput>(Keys.Mutation.CREATE_CONVERSATION, data),
    onSuccess: (newConversation) => {
      // Add to conversations cache
      queryClient.setQueryData<Conversation[]>([Keys.Query.GET_CONVERSATIONS], (old) => {
        if (!old) return [newConversation]
        // Check if already exists
        const exists = old.some((c) => c.id === newConversation.id)
        if (exists) return old
        return [newConversation, ...old]
      })
    },
  })
}

/**
 * Get all conversations for current user
 */
export function useGetConversations(enabled = true) {
  return useQuery<Conversation[], ApiError>({
    queryKey: [Keys.Query.GET_CONVERSATIONS],
    queryFn: () => getFetcher<Conversation[]>(Keys.Query.GET_CONVERSATIONS),
    enabled,
    staleTime: 30000, // 30 seconds
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  })
}

/** Decrypts the latest incoming message on this device for the conversation list. */
export function useConversationPreview(conversation: Conversation) {
  return useQuery<string | null, ApiError>({
    queryKey: [
      Keys.Query.CONVERSATION_PREVIEW,
      conversation.id,
      conversation.lastIncomingMessageId,
    ],
    enabled: Boolean(
      conversation.lastIncomingMessageId &&
        conversation.lastIncomingMessageSequence !== undefined &&
        conversation.lastIncomingMessageEncrypted,
    ),
    queryFn: async () => {
      const installId = await getE2EInstallId()
      const response = await getFetcher<MessagesResponse>(Keys.Query.GET_MESSAGES, {
        conversationId: conversation.id,
        installId,
        before: String((conversation.lastIncomingMessageSequence ?? 0) + 1),
        limit: '16',
      })
      let preview: string | null = null
      for (const message of response.messages) {
        try {
          const decrypted = await decryptE2EMessage(message)
          if (message.id === conversation.lastIncomingMessageId) preview = decrypted.text ?? null
        } catch {
          if (message.id === conversation.lastIncomingMessageId) preview = null
        }
      }
      return preview
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })
}

/**
 * Find DM conversation with a specific user from cache
 */
export function useFindDmWithUser(username: string) {
  const { data: conversations } = useGetConversations()

  return conversations?.find(
    (c) => !c.isGroup && c.participants.includes(username) && c.participants.length === 2,
  )
}

/**
 * Get the currently selected conversation object from cache
 */
export function useSelectedConversation(): Conversation | null {
  const selectedConversationId = useConversationStore((s) => s.selectedConversationId)
  const { data: conversations } = useGetConversations(Boolean(selectedConversationId))

  if (!selectedConversationId || !conversations) return null
  return conversations.find((c) => c.id === selectedConversationId) ?? null
}
