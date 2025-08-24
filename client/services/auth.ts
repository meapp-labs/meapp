import { ApiError, postFetcher } from '@/lib/axios';
import { LoginType, RegisterType } from '@/validation/userValidation';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';

export function useRegisterUser(onSuccess: () => void) {
    return useMutation<string, ApiError, RegisterType>({
        mutationFn: (body) => postFetcher('/register', body),
        onSuccess: onSuccess,
    });
}

export const loginUser = async (userData: LoginType) => {
    try {
        const response = await axios.post(
            'http://localhost:3000/login',
            userData,
            {
                withCredentials: true,
            },
        );
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const logoutUser = async () => {
    try {
        const response = await axios.post('http://localhost:3000/logout');
        return response.data;
    } catch (error) {
        throw error;
    }
};

// // components/Posts.jsx
// import { useQuery } from '@tanstack/react-query';
// import { fetchPosts } from '../api/posts';

// function Posts() {
//   const { data, error, isLoading } = useQuery({
//     queryKey: ['posts'],
//     queryFn: fetchPosts,
//   });

//   if (isLoading) return 'Loading...';
//   if (error) return 'An error has occurred: ' + error.message;
