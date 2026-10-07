import { getDbInstance } from '@meapp/db'

/** All read information belongs to the viewer; never aggregate other readers. */
export function conversationReadSummary(roomIds: string[], viewerId: string) {
  const result = new Map<
    string,
    {
      unreadCount: number
      firstUnreadSequence: number | null
      readState: Record<string, number>
    }
  >()
  if (!roomIds.length) return result
  const sqlite = getDbInstance().sqlite
  const placeholders = roomIds.map(() => '?').join(',')
  const counts = sqlite
    .query(`
    SELECT m.room_id AS roomId, COUNT(*) AS unreadCount, MIN(CASE WHEN m.thread_root_id IS NULL THEN m.sequence END) AS firstUnreadSequence
    FROM messages m LEFT JOIN message_receipts mr ON mr.message_id = m.id AND mr.user_id = ?
    WHERE m.room_id IN (${placeholders}) AND m.user_id <> ? AND mr.read_at IS NULL
    AND (m.is_encrypted=0 OR EXISTS (SELECT 1 FROM message_envelopes e WHERE e.message_id=m.id AND e.target_user_id=?))
    GROUP BY m.room_id
  `)
    .all(viewerId, ...roomIds, viewerId, viewerId) as {
    roomId: string
    unreadCount: number
    firstUnreadSequence: number
  }[]
  for (const roomId of roomIds)
    result.set(roomId, { unreadCount: 0, firstUnreadSequence: null, readState: {} })
  for (const row of counts) {
    const summary = result.get(row.roomId)
    if (summary) {
      summary.unreadCount = row.unreadCount
      summary.firstUnreadSequence = row.firstUnreadSequence
    }
  }
  const reads = sqlite
    .query(`SELECT m.room_id AS roomId, MAX(m.sequence) AS sequence
    FROM message_receipts mr JOIN messages m ON m.id = mr.message_id
    WHERE mr.user_id = ? AND mr.read_at IS NOT NULL AND m.room_id IN (${placeholders})
    GROUP BY m.room_id
  `)
    .all(viewerId, ...roomIds) as { roomId: string; sequence: number }[]
  for (const row of reads) {
    const summary = result.get(row.roomId)
    if (summary) summary.readState[viewerId] = row.sequence
  }
  return result
}
