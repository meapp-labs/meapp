import { Keys } from '@/lib/keys'
import { discardMediaUpload, retryMediaUpload } from '@/services/media'
import {
  mediaTransferSnapshot,
  pauseMediaTransfer,
  subscribeMediaTransfers,
} from '@/services/mediaTransfers'
import { theme } from '@/theme/theme'
import { useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { Pressable, Text, View } from 'react-native'
import Toast from 'react-native-toast-message'

export function MediaTransferPanel({ conversationId }: { conversationId: string }) {
  const transfers = useSyncExternalStore(
    subscribeMediaTransfers,
    mediaTransferSnapshot,
    mediaTransferSnapshot,
  )
  const queryClient = useQueryClient()
  const act = async (operation: () => Promise<unknown>) => {
    try {
      await operation()
      await queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_MESSAGES, conversationId] })
      await queryClient.invalidateQueries({ queryKey: [Keys.Query.GET_CONVERSATIONS] })
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Transfer interrupted',
        text2: error instanceof Error ? error.message : 'Try again',
      })
    }
  }
  return (
    <View>
      {transfers
        .filter((item) => item.roomId === conversationId)
        .map((item) => (
          <View key={item.id} style={{ padding: 12, gap: 8 }} accessibilityLiveRegion="polite">
            <Text style={{ color: theme.colors.text }}>
              {item.phase === 'uploading'
                ? `Uploading ${item.total ? Math.floor((100 * item.loaded) / item.total) : 0}%`
                : item.phase === 'sending'
                  ? 'Confirming delivery…'
                  : item.phase === 'paused'
                    ? 'Upload paused'
                    : 'Transfer interrupted — saved for retry'}
            </Text>
            {item.error && <Text style={{ color: theme.colors.textSecondary }}>{item.error}</Text>}
            <View style={{ flexDirection: 'row', gap: 24 }}>
              {item.phase === 'uploading' && (
                <Pressable accessibilityRole="button" onPress={() => pauseMediaTransfer(item.id)}>
                  <Text style={{ color: theme.colors.text }}>Pause upload</Text>
                </Pressable>
              )}
              {(item.phase === 'paused' || item.phase === 'failed') && (
                <>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void act(() => retryMediaUpload(item.id))}
                  >
                    <Text style={{ color: theme.colors.text }}>Retry / resume</Text>
                  </Pressable>
                  {item.canDiscard !== false && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void act(() => discardMediaUpload(item.id))}
                    >
                      <Text style={{ color: theme.colors.text }}>Discard</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          </View>
        ))}
    </View>
  )
}
