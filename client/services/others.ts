import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { ApiError, getFetcher } from '@/lib/axios';

export function useGetOthers() {
    const getOthersKey = 'get-others';
    return useQuery<string[], ApiError>({
        queryKey: [getOthersKey],
        queryFn: () => getFetcher<string[]>(`/${getOthersKey}`),
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
