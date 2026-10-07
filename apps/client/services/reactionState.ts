import type { ReactionEntry } from '@meapp/shared'

export function mergeReactions(current: ReactionEntry[], incoming: ReactionEntry[]) {
  const entries = new Map(current.map((entry) => [`${entry.messageId}:${entry.userId}`, entry]))
  for (const entry of incoming) {
    const key = `${entry.messageId}:${entry.userId}`
    if ((entries.get(key)?.revision ?? 0) < entry.revision) entries.set(key, entry)
  }
  return [...entries.values()]
}
