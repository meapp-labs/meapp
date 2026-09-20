import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Platform } from 'react-native'

import { type ApiError, postFetcher } from '@/lib/api'
import { Keys } from '@/lib/keys'
import { queryClient } from '@/lib/queryInit'
import type { LoginType, RegisterType } from '@meapp/shared'

export function useRegisterUser() {
  return useMutation<string, ApiError, RegisterType>({
    mutationFn: (body) => postFetcher(Keys.Mutation.REGISTER, { ...body, platform: Platform.OS }),
  })
}

export type LoginResult = string | { username: string; token: string }

export function useLoginUser() {
  return useMutation<LoginResult, ApiError, LoginType>({
    mutationFn: (body) => postFetcher(Keys.Mutation.LOGIN, { ...body, platform: Platform.OS }),
  })
}

export function useLogoutUser({ onSuccess }: { onSuccess: () => void }) {
  return useMutation<string, ApiError>({
    mutationFn: () => postFetcher<string, void>(Keys.Mutation.LOGOUT),
    onSuccess: () => {
      queryClient.clear()
      router.replace('/login')
      onSuccess()
    },
  })
}
