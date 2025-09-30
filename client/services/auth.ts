import { ApiError, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import { queryClient } from '@/lib/queryInit';
import { LoginType, RegisterType } from '@/validation/userValidation';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';

export function useRegisterUser
    ({ onSuccess }: { onSuccess: () => void }) {
    return useMutation<string, ApiError, RegisterType>({



        mutationFn:
            (body) => postFetcher(Keys.Mutation.REGISTER, body),
        onSuccess,
    });
}

export function
    useLoginUser() {
    return useMutation<string, ApiError, LoginType>({
        mutationFn: (body) => postFetcher(Keys.Mutation.LOGIN, body),
    });
}

export function
    seLogoutUser() {
    return console.log('zdupcyło się!!');
}
