import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { Platform } from 'react-native';

import { BaseMessage } from '@/components/chat/MessageBubble';
import { ApiError, getFetcher, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';

export interface MessageData {
  to: string;
  text: string;
}

export interface MessagesResponse {
  messages: BaseMessage[];
  hasMore: boolean;
  totalCount: number;
}

export interface LastMessage {
  text: string;
  date: string;
}

export function useSendMessage({
  selectedFriendName,
}: {
  selectedFriendName: string;
}) {
  const queryClient = useQueryClient();

  return useMutation<BaseMessage, ApiError, MessageData>({
    mutationFn: (messageData) =>
      postFetcher<BaseMessage, MessageData>(
        Keys.Mutation.SEND_MESSAGE,
        messageData,
      ),
    onSuccess: (newMessage) => {
      // Optimistically add the new message to the cache
      queryClient.setQueryData<{
        pages: MessagesResponse[];
        pageParams: { after?: number; before?: number }[];
      }>([Keys.Query.GET_MESSAGES, selectedFriendName], (old) => {
        if (!old || !old.pages[0]) return old;

        // Add the new message to the end of the first page
        // (server returns in ascending order, newest message has highest index)
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
    },
  });
}

export function useGetMessages({
  selectedFriendName,
  enabled = true,
}: {
  selectedFriendName: string;
  enabled?: boolean;
}) {
  return useInfiniteQuery<
    MessagesResponse,
    ApiError,
    {
      pages: MessagesResponse[];
      pageParams: { after?: number; before?: number }[];
      lastMessage?: LastMessage;
    },
    [string, string],
    { after?: number; before?: number }
  >({
    queryKey: [Keys.Query.GET_MESSAGES, selectedFriendName],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = {
        from: selectedFriendName,
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
    enabled,
    refetchInterval: Platform.OS === 'web' && enabled ? 5000 : false,
    refetchIntervalInBackground: false,
    select: (data) => {
      let lastMessage: LastMessage | undefined;
      for (const page of data.pages) {
        for (let i = page.messages.length - 1; i >= 0; i--) {
          const pageMessages = page.messages[i];
          if (pageMessages?.text && pageMessages?.from === selectedFriendName) {
            lastMessage = {
              text: pageMessages.text,
              date: pageMessages.timestamp,
            };
            break;
          }
        }
        if (lastMessage) break;
      }
      return {
        pages: data.pages,
        pageParams: data.pageParams,
        ...(lastMessage && { lastMessage: lastMessage }),
      };
    },
  });
}
