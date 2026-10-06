import { loadMedia } from '@/services/media'
import { mediaCacheEpoch } from '@/services/mediaCache'
import { theme } from '@/theme/theme'
import type { MediaDescriptor } from '@meapp/shared'
import { useRef, useState } from 'react'
import Toast from 'react-native-toast-message'

export function FileAttachment({ descriptor }: { descriptor: MediaDescriptor }) {
  const [uri, setUri] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const original = descriptor.variants.find((variant) => variant.name === 'orig')
  const load = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    const epoch = mediaCacheEpoch()
    try {
      const value = await loadMedia(descriptor)
      if (mediaCacheEpoch() !== epoch) throw new Error('Media session ended')
      setUri(value)
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'File unavailable',
        text2: error instanceof Error ? error.message : 'Please try again',
      })
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 180,
        maxWidth: '100%',
        color: theme.colors.text,
      }}
    >
      <span style={{ overflowWrap: 'anywhere' }}>{descriptor.fileName ?? 'Shared file'}</span>
      <span>{Math.max(0, (original?.size ?? 28) - 28).toLocaleString()} bytes</span>
      {!uri ? (
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? 'Loading…' : descriptor.kind === 'file' ? 'Prepare download' : 'Load media'}
        </button>
      ) : (
        <>
          {descriptor.kind === 'video' && (
            <video controls preload="metadata" src={uri} style={{ width: 280, maxWidth: '100%' }}>
              <track kind="captions" />
            </video>
          )}
          {descriptor.kind === 'audio' && (
            <audio controls preload="metadata" src={uri} style={{ width: 280, maxWidth: '100%' }}>
              <track kind="captions" />
            </audio>
          )}
          <a
            href={uri}
            download={descriptor.fileName ?? 'attachment'}
            style={{ color: theme.colors.text }}
          >
            Download file
          </a>
        </>
      )}
    </div>
  )
}
