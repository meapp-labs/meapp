import { getFetcher, patchFetcher } from '@/lib/api'
import { usePollingInterval } from '@/lib/polling'
import { useAuthStore } from '@/lib/stores'
import {
  type NotificationSettings,
  conversationMuteSchema,
  notificationSettingsSchema,
} from '@meapp/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
export function useNotificationSettings() {
  const username = useAuthStore((state) => state.username)
  const queryClient = useQueryClient()
  const queryKey = ['notification-settings', username]
  const query = useQuery({
    queryKey,
    queryFn: async () =>
      notificationSettingsSchema.parse(await getFetcher('notifications/settings')),
    refetchInterval: usePollingInterval(15000),
  })
  const update = useMutation({
    mutationFn: async (input: NotificationSettings) =>
      notificationSettingsSchema.parse(
        await patchFetcher('notifications/settings', notificationSettingsSchema.parse(input)),
      ),
    onSuccess: (value) => {
      queryClient.setQueryData(queryKey, value)
    },
  })
  return { ...query, update }
}
export function useConversationMute(roomId?: string) {
  const username = useAuthStore((state) => state.username)
  const queryClient = useQueryClient()
  const queryKey = ['conversation-mute', username, roomId]
  const query = useQuery({
    queryKey,
    enabled: !!roomId,
    queryFn: async () =>
      conversationMuteSchema.parse(await getFetcher(`notifications/rooms/${roomId}`)),
    refetchInterval: usePollingInterval(15000),
  })
  const update = useMutation({
    mutationFn: async (muted: boolean) =>
      conversationMuteSchema.parse(await patchFetcher(`notifications/rooms/${roomId}`, { muted })),
    onSuccess: (value) => {
      queryClient.setQueryData(queryKey, value)
    },
  })
  return { ...query, update }
}
