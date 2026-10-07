import type { MediaDescriptor, Message } from '@meapp/shared'

export type SharedFile = {
  descriptor: MediaDescriptor
  message: Message
  day: string
  month: string
}
export type SharedFileFilter = 'all' | 'photos' | 'video' | 'file' | 'audio'

export function isPhoto(descriptor: MediaDescriptor) {
  return descriptor.kind === 'image' || descriptor.kind === 'gif'
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase()

export function collectSharedFiles(messages: Message[]): SharedFile[] {
  const seen = new Set<string>()
  return messages
    .filter((message) => message.type !== 'undecryptable')
    .flatMap((message) => {
      const date = message.timestamp ? new Date(message.timestamp) : null
      const day =
        date && Number.isFinite(date.getTime())
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          : 'unknown'
      return (message.media ?? []).flatMap((descriptor) => {
        if (seen.has(descriptor.id)) return []
        seen.add(descriptor.id)
        return [{ descriptor, message, day, month: day === 'unknown' ? day : day.slice(0, 7) }]
      })
    })
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        Number(b.message.sequence ?? 0) - Number(a.message.sequence ?? 0),
    )
}

export function filterSharedFiles(files: SharedFile[], query: string, filter: SharedFileFilter) {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean)
  return files.filter(({ descriptor, message, day }) => {
    if (filter === 'photos' ? !isPhoto(descriptor) : filter !== 'all' && descriptor.kind !== filter)
      return false
    const text = normalize(
      [descriptor.fileName, message.from, message.text, day].filter(Boolean).join(' '),
    )
    return terms.every((term) => text.includes(term))
  })
}
