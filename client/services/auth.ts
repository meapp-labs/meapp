import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { ApiError, postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import { queryClient } from '@/lib/queryInit';
import { LoginType, RegisterType } from '@/validation/userValidation';

export function useRegisterUser() {
  return useMutation<string, ApiError, RegisterType>({
    mutationFn: (body) => postFetcher(Keys.Mutation.REGISTER, body),
  });
}

export function useLoginUser() {
  return useMutation<string, ApiError, LoginType>({
    mutationFn: (body) =>
      postFetcher(Keys.Mutation.LOGIN, { ...body, platform: Platform.OS }),
  });
}

export function useLogoutUser({ onSuccess }: { onSuccess: () => void }) {
  return useMutation<string, ApiError>({
    mutationFn: () => postFetcher<string, void>(Keys.Mutation.LOGOUT),
    onSuccess: () => {
      queryClient.clear();
      router.replace('/login');
      onSuccess();
    },
  });
}
