import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { type ApiError, getFetcher, postFetcher } from '@/lib/api'
import { Keys } from '@/lib/keys'
import type { FriendRequestLists } from '@meapp/shared'

type OtherInput = { other: string }

export function useGetFriends() {
  return useQuery<string[], ApiError>({
    queryKey: [Keys.Query.GET_FRIENDS],
    queryFn: () => getFetcher<string[]>(Keys.Query.GET_FRIENDS),
  })
}

export function useFriendRequests() {
  return useQuery<FriendRequestLists, ApiError>({
    queryKey: [Keys.Query.FRIEND_REQUESTS],
    queryFn: () => getFetcher<FriendRequestLists>(Keys.Query.FRIEND_REQUESTS),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  })
}

export function useIgnoredUsers() {
  return useQuery<string[], ApiError>({
    queryKey: [Keys.Query.IGNORED_USERS],
    queryFn: () => getFetcher<string[]>(Keys.Query.IGNORED_USERS),
  })
}

export function useAddFriend() {
  const queryClient = useQueryClient()
  return useMutation<string, ApiError, string>({
    mutationFn: (friend) =>
      postFetcher<string, OtherInput>(Keys.Mutation.ADD_FRIEND, { other: friend }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.FRIEND_REQUESTS] })
    },
  })
}

export function useAcceptFriendRequest() {
  const queryClient = useQueryClient()
  return useMutation<string, ApiError, string>({
    mutationFn: (other) =>
      postFetcher<string, OtherInput>(Keys.Mutation.ACCEPT_FRIEND_REQUEST, { other }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.FRIEND_REQUESTS] })
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_FRIENDS] })
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
    },
  })
}

export function useIgnoreFriendRequest() {
  const queryClient = useQueryClient()
  return useMutation<string, ApiError, string>({
    mutationFn: (other) =>
      postFetcher<string, OtherInput>(Keys.Mutation.IGNORE_FRIEND_REQUEST, { other }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.FRIEND_REQUESTS] })
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.IGNORED_USERS] })
    },
  })
}

export function useCancelFriendRequest() {
  const queryClient = useQueryClient()
  return useMutation<string, ApiError, string>({
    mutationFn: (other) =>
      postFetcher<string, OtherInput>(Keys.Mutation.CANCEL_FRIEND_REQUEST, { other }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.FRIEND_REQUESTS] })
    },
  })
}

export function useUnignoreUser() {
  const queryClient = useQueryClient()
  return useMutation<string, ApiError, string>({
    mutationFn: (other) => postFetcher<string, OtherInput>(Keys.Mutation.UNIGNORE_USER, { other }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.IGNORED_USERS] })
    },
  })
}

export function useRemoveFriend({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient()
  return useMutation<string, ApiError, string>({
    mutationFn: (friend) =>
      postFetcher<string, OtherInput>(Keys.Mutation.REMOVE_FRIEND, { other: friend }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_FRIENDS] })
      onSuccess()
    },
  })
}
