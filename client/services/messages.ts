import { TMessage } from '@/components/chat/MessageContainer';
import { ApiError, getFetcher, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import { useMutation, useQuery } from '@tanstack/react-query';

export interface MessageData {
    to: string;
    text: string;
}

export function useSendMessage(onSuccess: () => void) {
    return useMutation<TMessage, ApiError, MessageData>({
        mutationFn: (messageData) =>
            postFetcher<TMessage, MessageData>(
                `/${Keys.Mutation.SEND_MESSAGE}`,
                messageData,
            ),
        onSuccess,
    });
}

export function useGetMessages(from: string) {
    return useQuery<TMessage[], ApiError>({
        queryKey: [Keys.Query.GET_MESSAGES, from],
        queryFn: () =>
            getFetcher<TMessage[]>(`/${Keys.Query.GET_MESSAGES}`, { from }),
        enabled: !!from,
        refetchInterval: 5000,
    });
}
