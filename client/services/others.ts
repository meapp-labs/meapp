import axios from 'axios';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, getFetcher, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';

export function useGetFriends() {
    return useQuery<string[], ApiError>({
        queryKey: [Keys.Query.GET_FRIENDS],
        queryFn: () => getFetcher<string[]>(`/${Keys.Query.GET_FRIENDS}`),
    });
}

export const addFriend = async (friend: string) => {
    try {
        const response = await axios.post(
            'http://localhost:3000/add-other',
            { other: friend },
            { withCredentials: true },
        );
        return response.data;
    } catch (error) {
        throw error;
    }
};

export function useAddFriend(onSuccess: () => void) {
    return useMutation<string, ApiError, string>({
        mutationFn: (friend) =>
            postFetcher<string, { other: string }>(
                `/${Keys.Mutation.ADD_FRIEND}`,
                { other: friend },
            ),
        onSuccess,
    });
}

export function useRemoveFriend(onSuccess: () => void) {
    return useMutation<string, ApiError, string>({
        mutationFn: (friend) =>
            postFetcher<string, { other: string }>(
                `/${Keys.Mutation.REMOVE_FRIEND}`,
                { other: friend },
            ),
        onSuccess,
    });
}
