type PreviewContent = {
  text?: string | undefined
  media?: ReadonlyArray<{ kind: 'image' | 'gif' | 'video' | 'audio' | 'file' }> | undefined
}

/** Summarize decrypted content without exposing media keys or URLs. */
export function messagePreview(
  content: PreviewContent,
  direction: 'sent' | 'received' = 'sent',
): string | null {
  if (content.text) return content.text
  if (!content.media?.length) return null

  const kind = content.media[0]?.kind
  const multiple = content.media.length > 1
  if (!content.media.every((attachment) => attachment.kind === kind))
    return `Attachments were ${direction}`
  const label =
    kind === 'image'
      ? 'Image'
      : kind === 'gif'
        ? 'GIF'
        : kind === 'video'
          ? 'Video'
          : kind === 'audio'
            ? 'Audio file'
            : 'File'
  return `${label}${multiple ? 's were' : ' was'} ${direction}`
}
