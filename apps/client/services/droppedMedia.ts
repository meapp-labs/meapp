import { MEDIA_MAX_ATTACHMENTS, MEDIA_MAX_BYTES } from '@meapp/shared'

const formats = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
  ['mp3', 'audio/mpeg'],
  ['m4a', 'audio/mp4'],
  ['wav', 'audio/wav'],
  ['ogg', 'audio/ogg'],
  ['flac', 'audio/flac'],
  ['zip', 'application/zip'],
  ['pdf', 'application/pdf'],
])

export function droppedMediaTypes(
  files: ReadonlyArray<{ name: string; type: string; size: number }>,
) {
  if (files.length < 1 || files.length > MEDIA_MAX_ATTACHMENTS)
    throw new Error('Select between 1 and 4 files at once')
  return files.map((file) => {
    const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
    const rawMime =
      (file.type && file.type !== 'application/octet-stream'
        ? file.type
        : formats.get(extension)) || 'application/octet-stream'
    const mime =
      rawMime.length <= 127 && /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(rawMime)
        ? rawMime.toLowerCase()
        : 'application/octet-stream'
    if (file.size === 0) throw new Error('Cannot send an empty file')
    if (file.size > MEDIA_MAX_BYTES - 28)
      throw new Error('Each file must fit the 100 MB encrypted upload limit')
    return mime
  })
}

export function optimizedImageMime(mime: string) {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/bmp', 'image/gif'].includes(
    mime,
  )
}

export function safeAttachmentName(name: string) {
  return (
    Array.from(name, (character) =>
      character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127 ||
      character === '/' ||
      character === '\\'
        ? '_'
        : character,
    )
      .join('')
      .slice(0, 255) || 'attachment'
  )
}

export function attachmentCacheName(
  id: string,
  mime: string,
  fileName?: string,
  thumbnail = false,
) {
  const known = new Map([
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['video/mp4', 'mp4'],
    ['audio/mpeg', 'mp3'],
  ])
  const extension = fileName?.split('.').at(-1)?.toLowerCase()
  const suffix =
    known.get(mime) ?? (extension && /^[a-z0-9]{1,16}$/.test(extension) ? extension : 'bin')
  return `${id}${thumbnail ? '-thumb' : ''}.${suffix}`
}
