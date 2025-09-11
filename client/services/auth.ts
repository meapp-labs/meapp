import { ApiError, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import { LoginType, RegisterType } from '@/validation/userValidation';
import { useMutation } from '@tanstack/react-query';

export function useRegisterUser(onSuccess: () => void) {
    return useMutation<string, ApiError, RegisterType>({
        mutationFn: (body) => postFetcher(`/${Keys.Mutation.REGISTER}`, body),
        onSuccess,
    });
}

export function useLoginUser() {
    return useMutation<string, ApiError, LoginType>({
        mutationFn: (body) => postFetcher(`/${Keys.Mutation.LOGIN}`, body),
    });
}

export function useLogoutUser(onSuccess: () => void) {
    return useMutation<string, ApiError>({
        mutationFn: () =>
            postFetcher<string, void>(`/${Keys.Mutation.LOGOUT}`, undefined),
        onSuccess,
    });
}
