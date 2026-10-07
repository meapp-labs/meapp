import { loadMedia } from '@/services/media'
import { mediaCacheEpoch } from '@/services/mediaCache'
import type { MediaDescriptor } from '@meapp/shared'
import { useEffect, useRef, useState } from 'react'
import Toast from 'react-native-toast-message'

export function useAttachmentDownload(descriptor: MediaDescriptor) {
  const [uri, setUri] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const load = async () => {
    if (controller.current) return null
    const active = new AbortController()
    controller.current = active
    const epoch = mediaCacheEpoch()
    setBusy(true)
    setPercent(0)
    try {
      const value = await loadMedia(descriptor, 'orig', {
        signal: active.signal,
        onProgress: (n, total) => setPercent(Math.floor((100 * n) / total)),
      })
      active.signal.throwIfAborted()
      if (mediaCacheEpoch() !== epoch) throw new Error('Media session ended')
      setUri(value)
      return value
    } catch (error) {
      if (!active.signal.aborted)
        Toast.show({
          type: 'error',
          text1: 'File unavailable',
          text2: error instanceof Error ? error.message : 'Try again',
        })
      return null
    } finally {
      if (controller.current === active) controller.current = null
      setBusy(false)
    }
  }
  return { uri, busy, percent, load, cancel: () => controller.current?.abort() }
}
