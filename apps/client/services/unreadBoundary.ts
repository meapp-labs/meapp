import type { Message } from '@meapp/shared'

export type UnreadBoundary = { sequence: number | null; initialMax: number }

/** Keep the reading landmark stable after visible messages are acknowledged. */
export function updateUnreadBoundary(
  previous: UnreadBoundary | null,
  messages: Message[],
  username: string,
  firstUnreadSequence: number | null,
): UnreadBoundary {
  if (previous !== null && previous.sequence !== null) return previous
  const initialMax = previous?.initialMax ?? Math.max(0, ...messages.map((m) => m.sequence ?? 0))
  const incoming = messages.filter(
    (m) =>
      m.from !== username &&
      m.sequence !== undefined &&
      !m.acknowledgedRead &&
      (previous === null || m.sequence > initialMax),
  )
  const sequence =
    previous === null
      ? firstUnreadSequence
      : incoming.length
        ? Math.min(...incoming.map((m) => m.sequence as number))
        : null
  return { sequence, initialMax }
}
