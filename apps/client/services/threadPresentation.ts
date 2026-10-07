import type { Message, ThreadSummary } from '@meapp/shared'

export function visibleMessages(messages: Message[], rootId?: string, root?: Message) {
  const unique = new Map<string, Message>()
  if (root && root.id === rootId) unique.set(root.id, root)
  for (const message of messages) {
    if (rootId ? message.threadRootId === rootId || message.id === rootId : !message.threadRootId)
      unique.set(message.id, message)
  }
  return [...unique.values()].sort(
    (a, b) =>
      Number(b.sequence ?? Number.MAX_SAFE_INTEGER) - Number(a.sequence ?? Number.MAX_SAFE_INTEGER),
  )
}

export function threadLabel(summary: ThreadSummary | undefined) {
  if (!summary) return 'View thread'
  return `${summary.replyCount} ${summary.replyCount === 1 ? 'reply' : 'replies'}${summary.unreadCount ? ` · ${summary.unreadCount} unread` : ''}`
}
