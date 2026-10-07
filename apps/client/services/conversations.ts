import { usePollingInterval } from '@/lib/polling'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { type ApiError, getFetcher, postFetcher } from '@/lib/api'
import { Keys } from '@/lib/keys'
import { useConversationStore } from '@/lib/stores'
import { decryptE2EMessage, getE2EInstallId } from '@/services/e2e'
import type { Conversation, CreateConversationInput, MessagesResponse } from '@meapp/shared'
import { messagePreview } from './messagePreview'

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
  const pollInterval = usePollingInterval(15_000)
  return useQuery<Conversation[], ApiError>({
    queryKey: [Keys.Query.GET_CONVERSATIONS],
    queryFn: () => getFetcher<Conversation[]>(Keys.Query.GET_CONVERSATIONS),
    enabled,
    staleTime: 30000, // 30 seconds
    refetchInterval: pollInterval,
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
      'content-v3',
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
          if (message.id === conversation.lastIncomingMessageId)
            preview = messagePreview(decrypted, 'received')
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

// ─────────────────────────────────────────────────────────────
// Group Management Hooks
// ─────────────────────────────────────────────────────────────

import { deleteFetcher, patchFetcher } from '@/lib/api'
import type {
  AddGroupMemberInput,
  CreateInviteInput,
  GroupInviteResponse,
  GroupMember,
  JoinInviteInput,
  LeaveGroupInput,
  TransferAdminInput,
  UpdateGroupInput,
} from '@meapp/shared'

export function useGetGroupMembers(roomId: string | undefined, enabled = true) {
  const membersPollInterval = usePollingInterval(30_000)
  return useQuery<GroupMember[], ApiError>({
    queryKey: ['rooms', roomId, 'members'],
    queryFn: () => getFetcher<GroupMember[]>(`rooms/${roomId}/members`),
    enabled: Boolean(roomId && enabled),
    staleTime: 10000,
    refetchInterval: enabled ? membersPollInterval : false,
  })
}

export function useAddGroupMember(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ success: boolean; member: GroupMember }, ApiError, AddGroupMemberInput>({
    mutationFn: (data) =>
      postFetcher<{ success: boolean; member: GroupMember }, AddGroupMemberInput>(
        `rooms/${roomId}/members`,
        data,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'members'] })
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
    },
  })
}

export function useLeaveGroup() {
  const queryClient = useQueryClient()
  return useMutation<{ success: boolean }, ApiError, { roomId: string; data?: LeaveGroupInput }>({
    mutationFn: ({ roomId, data }) =>
      postFetcher<{ success: boolean }, LeaveGroupInput>(`rooms/${roomId}/leave`, data ?? {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
      useConversationStore.getState().setSelectedConversationId(null)
    },
  })
}

export function useRemoveGroupMember(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ success: boolean }, ApiError, { userId: string }>({
    mutationFn: ({ userId }) =>
      deleteFetcher<{ success: boolean }>(`rooms/${roomId}/members/${userId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'members'] })
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
    },
  })
}

export function useRenameGroup(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ id: string; name: string }, ApiError, UpdateGroupInput>({
    mutationFn: (data) =>
      patchFetcher<{ id: string; name: string }, UpdateGroupInput>(`rooms/${roomId}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
    },
  })
}

export function useCreateGroupInvite(roomId: string) {
  const client = useQueryClient()
  return useMutation<GroupInviteResponse, ApiError, CreateInviteInput | undefined>({
    mutationFn: (data) =>
      postFetcher<GroupInviteResponse, CreateInviteInput | undefined>(
        `rooms/${roomId}/invites`,
        data ?? {},
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rooms', roomId, 'invites'] })
    },
  })
}

export function useGroupInvites(roomId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['rooms', roomId, 'invites'],
    enabled,
    queryFn: () => getFetcher<GroupInviteResponse[]>(`rooms/${roomId}/invites`),
  })
}

export function useRevokeGroupInvite(roomId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (tokenHash: string) => deleteFetcher(`rooms/${roomId}/invites/${tokenHash}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['rooms', roomId, 'invites'] })
    },
  })
}

export function useJoinGroupInvite() {
  const queryClient = useQueryClient()
  return useMutation<{ success: boolean; roomId: string }, ApiError, JoinInviteInput>({
    mutationFn: (data) =>
      postFetcher<{ success: boolean; roomId: string }, JoinInviteInput>('invites/join', data),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
      useConversationStore.getState().setSelectedConversationId(res.roomId)
    },
  })
}

export function useTransferGroupAdmin(roomId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ success: boolean }, ApiError, TransferAdminInput>({
    mutationFn: (data) =>
      postFetcher<{ success: boolean }, TransferAdminInput>(`rooms/${roomId}/transfer-admin`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'members'] })
    },
  })
}
