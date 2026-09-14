import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { ApiError, getFetcher, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import type {
  Conversation,
  Message,
  MessagesResponse,
  SendMessageRequest,
} from '@/types/models';

// Re-export for backwards compatibility
export type { MessagesResponse } from '@/types/models';

/**
 * Update the conversation list cache with a new message preview
 */
function updateConversationListCache(
  queryClient: QueryClient,
  conversationId: string,
  lastMessage: Message,
) {
  queryClient.setQueryData<Conversation[]>(
    [Keys.Query.GET_CONVERSATIONS],
    (old) => {
      if (!old) return old;
      return old.map((c: Conversation) => {
        if (c.id === conversationId) {
          return {
            ...c,
            lastMessagePreview: lastMessage.text,
            lastMessageAt: lastMessage.timestamp,
          };
        }
        return c;
      });
    },
  );
}

/**
 * Send a message to a conversation
 */
export function useSendMessage({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();

  return useMutation<Message, ApiError, { text: string }>({
    mutationFn: ({ text }) =>
      postFetcher<Message, SendMessageRequest>(Keys.Mutation.SEND_MESSAGE, {
        conversationId,
        text,
      }),
    onSuccess: (newMessage) => {
      // Add the new message to the messages cache
      queryClient.setQueryData<{
        pages: MessagesResponse[];
        pageParams: { after?: number; before?: number }[];
      }>([Keys.Query.GET_MESSAGES, conversationId], (old) => {
        if (!old || !old.pages[0]) return old;

        const updatedMessages = [...old.pages[0].messages, newMessage];

        return {
          ...old,
          pages: [
            {
              messages: updatedMessages,
              hasMore: old.pages[0].hasMore,
              totalCount: old.pages[0].totalCount + 1,
            },
            ...old.pages.slice(1),
          ],
          pageParams: old.pageParams,
        };
      });

      // Update conversation list cache to sync preview
      updateConversationListCache(queryClient, conversationId, newMessage);
    },
  });
}

/**
 * Get the last message index from cached data
 */
function getLastMessageIndex(
  data: { pages: MessagesResponse[] } | undefined,
): number | undefined {
  if (!data?.pages[0]?.messages.length) return undefined;

  const firstPage = data.pages[0];
  const lastMessage = firstPage.messages[firstPage.messages.length - 1];
  return lastMessage?.index;
}

/**
 * Get messages for a conversation with infinite scroll
 * Uses custom polling to only fetch new messages (after last known index)
 */
export function useGetMessages({
  conversationId,
  enabled = true,
}: {
  conversationId: string;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const query = useInfiniteQuery<
    MessagesResponse,
    ApiError,
    {
      pages: MessagesResponse[];
      pageParams: { after?: number; before?: number }[];
    },
    [string, string],
    { after?: number; before?: number }
  >({
    queryKey: [Keys.Query.GET_MESSAGES, conversationId],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = {
        conversationId,
        limit: '16',
      };

      if (pageParam['after'] !== undefined) {
        params['after'] = pageParam['after'].toString();
      } else if (pageParam['before'] !== undefined) {
        params['before'] = pageParam['before'].toString();
      }

      return getFetcher<MessagesResponse>(Keys.Query.GET_MESSAGES, params);
    },
    initialPageParam: {},
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore && lastPage.messages.length > 0) {
        const firstMessage = lastPage.messages[0];
        const index = firstMessage?.index;
        if (index !== undefined) {
          return { before: Number(index) };
        }
      }
      return undefined;
    },
    enabled: !!conversationId && enabled,
  });

  // Custom polling: fetch only new messages using `after` parameter
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || !conversationId) {
      return;
    }

    const pollForNewMessages = async () => {
      const currentData = queryClient.getQueryData<{
        pages: MessagesResponse[];
        pageParams: { after?: number; before?: number }[];
      }>([Keys.Query.GET_MESSAGES, conversationId]);

      const lastIndex = getLastMessageIndex(currentData);
      if (lastIndex === undefined) return;

      try {
        // Fetch only messages after the last known index
        const newMessages = await getFetcher<MessagesResponse>(
          Keys.Query.GET_MESSAGES,
          {
            conversationId,
            after: lastIndex.toString(),
            limit: '50',
          },
        );

        if (newMessages.messages.length > 0) {
          // Append new messages to the first page
          queryClient.setQueryData<{
            pages: MessagesResponse[];
            pageParams: { after?: number; before?: number }[];
          }>([Keys.Query.GET_MESSAGES, conversationId], (old) => {
            if (!old || !old.pages[0]) return old;

            return {
              ...old,
              pages: [
                {
                  messages: [...old.pages[0].messages, ...newMessages.messages],
                  hasMore: old.pages[0].hasMore,
                  totalCount: newMessages.totalCount,
                },
                ...old.pages.slice(1),
              ],
              pageParams: old.pageParams,
            };
          });

          // Update conversation list cache to sync preview
          const latestMessage =
            newMessages.messages[newMessages.messages.length - 1];
          if (latestMessage) {
            updateConversationListCache(
              queryClient,
              conversationId,
              latestMessage,
            );
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    };

    pollingIntervalRef.current = setInterval(() => {
      void pollForNewMessages();
    }, 5000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [conversationId, enabled, queryClient]);

  return query;
}
