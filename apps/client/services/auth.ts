import { useMutation } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Platform } from 'react-native'

import { type ApiError, postFetcher } from '@/lib/api'
import { AuthStorage } from '@/lib/authStorage'
import { Keys } from '@/lib/keys'
import { queryClient } from '@/lib/queryInit'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import type { LoginType, RegisterType } from '@meapp/shared'
import { resetE2EContext } from './e2e'
import { ConversationStorage, RememberMeStorage } from './storage'

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

export function useLogoutUser() {
  return useMutation<string, ApiError>({
    mutationFn: () => postFetcher<string, void>(Keys.Mutation.LOGOUT),
    onSettled: async () => {
      await Promise.all([
        AuthStorage.clear(),
        RememberMeStorage.clear(),
        ConversationStorage.clear(),
      ])
      resetE2EContext()
      queryClient.clear()
      useConversationStore.getState().setSelectedConversationId(null)
      useAuthStore.getState().setUsername('')
      router.replace('/login')
    },
  })
}
