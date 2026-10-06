import { Text } from '@/components/common/Text'
import { loadMedia } from '@/services/media'
import { mediaCacheEpoch } from '@/services/mediaCache'
import type { MediaDescriptor } from '@meapp/shared'
import * as Sharing from 'expo-sharing'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import Toast from 'react-native-toast-message'

export function FileAttachment({ descriptor }: { descriptor: MediaDescriptor }) {
  const [busy, setBusy] = useState(false)
  const original = descriptor.variants.find((variant) => variant.name === 'orig')
  const open = async () => {
    if (busy) return
    const epoch = mediaCacheEpoch()
    setBusy(true)
    try {
      const uri = await loadMedia(descriptor)
      if (mediaCacheEpoch() !== epoch) throw new Error('Media session ended')
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
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ minWidth: 180, gap: 8 }}>
      <Text>{descriptor.fileName ?? 'Shared file'}</Text>
      <Text>{Math.max(0, (original?.size ?? 28) - 28).toLocaleString()} bytes</Text>
      <Pressable disabled={busy} onPress={() => void open()} accessibilityRole="button">
        <Text>{busy ? 'Loading…' : 'Open / save file'}</Text>
      </Pressable>
    </View>
  )
}
