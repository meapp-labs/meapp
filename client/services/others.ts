import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, getFetcher, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';

export function useGetFriends() {
    return useQuery<string[], ApiError>({
        queryKey: [Keys.Query.GET_FRIENDS],
        queryFn: () => getFetcher<string[]>(Keys.Query.GET_FRIENDS),
    });
}

export function useAddFriend({ onSuccess }: { onSuccess: () => void }) {
    return useMutation<string, ApiError, string>({
        mutationFn: (friend) =>
            postFetcher<string, { other: string }>(Keys.Mutation.ADD_FRIEND, {
                other: friend,
            }),
        onSuccess,
    });
}

export function useRemoveFriend({ onSuccess }: { onSuccess: () => void }) {
    return useMutation<string, ApiError, string>({
        mutationFn: (friend) =>
            postFetcher<string, { other: string }>(
                Keys.Mutation.REMOVE_FRIEND,
                {
                    other: friend,
                },
            ),
        onSuccess,
    });
}
