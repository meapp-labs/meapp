import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { ApiError, getFetcher } from '@/lib/axios';
import { QueryKeys } from '@/lib/queryKeys';

export function useGetOthers() {
    return useQuery<string[], ApiError>({
        queryKey: [QueryKeys.GET_OTHERS],
        queryFn: () => getFetcher<string[]>(`/${QueryKeys.GET_OTHERS}`),
    });
}

export const addOther = async (other: string) => {
    try {
        const response = await axios.post(
            'http://localhost:3000/add-other',
            { other },
            { withCredentials: true },
        );
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const removeOther = async (other: string) => {
    try {
        const response = await axios.post(
            'http://localhost:3000/remove-other',
            { other },
            { withCredentials: true },
        );
        return response.data;
    } catch (error) {
        throw error;
    }
};
