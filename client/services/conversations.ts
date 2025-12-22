import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, getFetcher, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import type { Conversation, CreateConversationRequest } from '@/types/models';

/**
 * Create or get existing conversation
 */
export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation<Conversation, ApiError, CreateConversationRequest>({
    mutationFn: (data) =>
      postFetcher<Conversation, CreateConversationRequest>(
        Keys.Mutation.CREATE_CONVERSATION,
        data,
      ),
    onSuccess: (newConversation) => {
      // Add to conversations cache
      queryClient.setQueryData<Conversation[]>(
        [Keys.Query.GET_CONVERSATIONS],
        (old) => {
          if (!old) return [newConversation];
          // Check if already exists
          const exists = old.some((c) => c.id === newConversation.id);
          if (exists) return old;
          return [newConversation, ...old];
        },
      );
    },
  });
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
  });
}

/**
 * Find DM conversation with a specific user from cache
 */
export function useFindDmWithUser(username: string) {
  const { data: conversations } = useGetConversations();

  return conversations?.find(
    (c) =>
      !c.isGroup &&
      c.participants.includes(username) &&
      c.participants.length === 2,
  );
}
