import { TMessage } from '@/components/chat/MessageContainer';
import { ApiError, getFetcher, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import { useMutation, useQuery } from '@tanstack/react-query';
import { usePressedStore } from '@/stores/pressedFriendStore';

export interface MessageData {
    to: string;
    text: string;
}

export function useSendMessage(onSuccess: () => void) {
    return useMutation<TMessage, ApiError, MessageData>({
        mutationFn: (messageData) =>
            postFetcher<TMessage, MessageData>(
                Keys.Mutation.SEND_MESSAGE,
                messageData,
            ),
        onSuccess,
    });
}

export function useGetMessages({ from }: { from: string }) {
    const { pressed } = usePressedStore();
    return useQuery<TMessage[], ApiError>({
        queryKey: [Keys.Query.GET_MESSAGES, from],
        queryFn: () =>
            getFetcher<TMessage[]>(Keys.Query.GET_MESSAGES, { from }),
        enabled: !!pressed?.name,
        refetchInterval: 5000,
    });
}
