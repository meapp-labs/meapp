import { useMutation, useQuery } from '@tanstack/react-query';

import { BaseMessage } from '@/components/chat/Message.js';
import { ApiError, getFetcher, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';

export interface MessageData {
  to: string;
  text: string;
}

export function useSendMessage({ onSuccess }: { onSuccess: () => void }) {
  return useMutation<BaseMessage, ApiError, MessageData>({
    mutationFn: (messageData) =>
      postFetcher<BaseMessage, MessageData>(
        Keys.Mutation.SEND_MESSAGE,
        messageData,
      ),
    onSuccess,
  });
}

export function useGetMessages({ from }: { from: string | undefined }) {
  return useQuery<BaseMessage[], ApiError>({
    queryKey: [Keys.Query.GET_MESSAGES, from],
    queryFn: () =>
      getFetcher<BaseMessage[]>(Keys.Query.GET_MESSAGES, { from: from! }),
    enabled: Boolean(from),
    refetchInterval: 5000,
  });
}
