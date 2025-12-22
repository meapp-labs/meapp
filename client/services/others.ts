import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, getFetcher, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import type { Conversation, CreateConversationRequest } from '@/types/models';

export function useGetFriends() {
  return useQuery<string[], ApiError>({
    queryKey: [Keys.Query.GET_FRIENDS],
    queryFn: () => getFetcher<string[]>(Keys.Query.GET_FRIENDS),
  });
}

/**
 * Add friend and create conversation with them
 */
export function useAddFriend({
  onSuccess,
}: {
  onSuccess: (conversation: Conversation) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation<Conversation, ApiError, string>({
    mutationFn: async (friend) => {
      // First add the friend
      await postFetcher<string, { other: string }>(Keys.Mutation.ADD_FRIEND, {
        other: friend,
      });

      // Then create conversation with them
      const conversation = await postFetcher<
        Conversation,
        CreateConversationRequest
      >(Keys.Mutation.CREATE_CONVERSATION, {
        type: 'dm',
        participants: [friend],
      });

      return conversation;
    },
    onSuccess: (conversation) => {
      // Invalidate friends list
      void queryClient.invalidateQueries({
        queryKey: [Keys.Query.GET_FRIENDS],
      });

      // Add to conversations cache
      queryClient.setQueryData<Conversation[]>(
        [Keys.Query.GET_CONVERSATIONS],
        (old) => {
          if (!old) return [conversation];
          const exists = old.some((c) => c.id === conversation.id);
          if (exists) return old;
          return [conversation, ...old];
        },
      );

      onSuccess(conversation);
    },
  });
}

export function useRemoveFriend({ onSuccess }: { onSuccess: () => void }) {
  return useMutation<string, ApiError, string>({
    mutationFn: (friend) =>
      postFetcher<string, { other: string }>(Keys.Mutation.REMOVE_FRIEND, {
        other: friend,
      }),
    onSuccess,
  });
}
