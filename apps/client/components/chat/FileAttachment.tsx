import { Text } from '@/components/common/Text'
import { mediaCacheEpoch } from '@/services/mediaCache'
import { useAttachmentDownload } from '@/services/useAttachmentDownload'
import type { MediaDescriptor } from '@meapp/shared'
import * as Sharing from 'expo-sharing'
import { Pressable, View } from 'react-native'
import Toast from 'react-native-toast-message'
import { AudioPlayback } from './AudioPlayback'
import { VideoPlayback } from './VideoPlayback'

export function FileAttachment({ descriptor }: { descriptor: MediaDescriptor }) {
  const { uri, busy, percent, load, cancel } = useAttachmentDownload(descriptor)
  const original = descriptor.variants.find((variant) => variant.name === 'orig')
  const open = async () => {
    if (busy) return
    const epoch = mediaCacheEpoch()
    try {
      const uri = await load()
      if (!uri) return
      if (mediaCacheEpoch() !== epoch) throw new Error('Media session ended')
      if (descriptor.kind === 'audio' || descriptor.kind === 'video') {
        return
      }
      if (!(await Sharing.isAvailableAsync()))
        throw new Error('File sharing is unavailable on this device')
      if (mediaCacheEpoch() !== epoch) throw new Error('Media session ended')
      await Sharing.shareAsync(uri, {
        mimeType: original?.mime ?? 'application/octet-stream',
        dialogTitle: descriptor.fileName ?? 'Shared file',
      })
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'File unavailable',
        text2: error instanceof Error ? error.message : 'Please try again',
      })
    }
  }
  return (
    <View style={{ minWidth: 180, gap: 8 }}>
      <Text>{descriptor.fileName ?? 'Shared file'}</Text>
      <Text>{Math.max(0, (original?.size ?? 28) - 28).toLocaleString()} bytes</Text>
      {busy && (
        <Pressable accessibilityRole="button" onPress={cancel}>
          <Text>Cancel download · {percent}%</Text>
        </Pressable>
      )}
      {uri && descriptor.kind === 'audio' && <AudioPlayback uri={uri} />}
      {uri && descriptor.kind === 'video' && <VideoPlayback uri={uri} />}
      <Pressable disabled={busy} onPress={() => void open()} accessibilityRole="button">
        <Text>
          {busy
            ? `Loading ${percent}%…`
            : descriptor.kind === 'file'
              ? 'Export / save file'
              : 'Load media'}
        </Text>
      </Pressable>
    </View>
  )
}
