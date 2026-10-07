import { useAttachmentDownload } from '@/services/useAttachmentDownload'
import { theme } from '@/theme/theme'
import type { MediaDescriptor } from '@meapp/shared'

export function FileAttachment({ descriptor }: { descriptor: MediaDescriptor }) {
  const { uri, busy, percent, load, cancel } = useAttachmentDownload(descriptor)
  const original = descriptor.variants.find((variant) => variant.name === 'orig')
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
      {busy && (
        <button type="button" onClick={cancel}>
          Cancel download · {percent}%
        </button>
      )}
      {!uri ? (
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy
            ? `Loading ${percent}%…`
            : descriptor.kind === 'file'
              ? 'Prepare download'
              : 'Load media'}
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
            Export / download file
          </a>
          <button type="button" disabled={busy} onClick={() => void load()}>
            {busy ? `Loading ${percent}%…` : 'Reload media'}
          </button>
        </>
      )}
    </div>
  )
}
