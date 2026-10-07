import type { Message } from '@meapp/shared'
export function searchHistory(messages: Message[], query: string, filesOnly = false) {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase()
  const seen = new Set<string>()
  return messages
    .filter((message) => {
      if (seen.has(message.id) || message.type === 'undecryptable') return false
      seen.add(message.id)
      if (filesOnly && !message.media?.length) return false
      const text = [
        message.text ?? '',
        ...(message.media?.map((media) => media.fileName ?? '') ?? []),
      ]
        .join('\n')
        .normalize('NFKC')
        .toLocaleLowerCase()
      return !needle || text.includes(needle)
    })
    .sort((a, b) => Number(b.sequence ?? 0) - Number(a.sequence ?? 0))
}
