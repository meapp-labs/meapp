import { getDbInstance } from '@meapp/db'
import type { ThreadSummary } from '@meapp/shared'
import { chatTimestampIso } from './dbTime.ts'
import { createForbiddenError, createValidationError } from './errors.ts'

export function requireThreadRoot(
  roomId: string,
  rootId: string,
  userId: string,
  deviceId: number,
) {
  const row = getDbInstance()
    .sqlite.query(`SELECT m.thread_root_id AS threadRootId, m.user_id AS userId
    FROM messages m WHERE m.id=? AND m.room_id=?
    AND (m.is_encrypted=0 OR m.user_id=? OR EXISTS (SELECT 1 FROM message_envelopes e
      WHERE e.message_id=m.id AND e.target_user_id=? AND e.target_device_id=?))`)
    .get(rootId, roomId, userId, userId, deviceId) as {
    threadRootId: string | null
    userId: string
  } | null
  if (!row) throw createForbiddenError('This thread is unavailable on your device')
  if (row.threadRootId)
    throw createValidationError(
      'Replies belong to the original thread; nested threads are not supported',
    )
  return row
}

export function requireThreadTarget(
  roomId: string,
  rootId: string,
  targetId: string | undefined,
  userId: string,
  deviceId: number,
) {
  requireThreadRoot(roomId, rootId, userId, deviceId)
  if (!targetId || targetId === rootId) return
  const target = getDbInstance()
    .sqlite.query(`SELECT m.thread_root_id AS rootId FROM messages m WHERE m.id=? AND m.room_id=?
    AND (m.user_id=? OR EXISTS (SELECT 1 FROM message_envelopes e WHERE e.message_id=m.id AND e.target_user_id=? AND e.target_device_id=?))`)
    .get(targetId, roomId, userId, userId, deviceId) as { rootId: string | null } | null
  if (!target || target.rootId !== rootId)
    throw createValidationError('The quoted message must belong to this thread')
}

/** Current members from the root's original audience, including their linked devices. */
export function threadRecipientDevices(roomId: string, rootId: string) {
  return getDbInstance()
    .sqlite.query(`SELECT ri.user_id AS userId, u.username, ri.device_id AS deviceId
    FROM room_members rm JOIN users u ON u.id=rm.user_id
    JOIN relay_identities ri ON ri.user_id=rm.user_id
    WHERE rm.room_id=? AND (rm.user_id=(SELECT user_id FROM messages WHERE id=?)
      OR EXISTS (SELECT 1 FROM message_envelopes e WHERE e.message_id=? AND e.target_user_id=rm.user_id))`)
    .all(roomId, rootId, rootId) as { userId: string; username: string; deviceId: number }[]
}

export function getThreadSummaries(
  roomId: string,
  userId: string,
  deviceId: number,
): Record<string, ThreadSummary> {
  const rows = getDbInstance()
    .sqlite.query(`SELECT m.thread_root_id AS rootId, COUNT(*) AS replyCount,
    COUNT(DISTINCT m.user_id) AS participantCount, MAX(m.sequence) AS lastReplySequence,
    MAX(m.created_at) AS lastReplyAt,
    SUM(CASE WHEN m.user_id<>? AND mr.read_at IS NULL THEN 1 ELSE 0 END) AS unreadCount,
    MIN(CASE WHEN m.user_id<>? AND mr.read_at IS NULL THEN m.sequence END) AS firstUnreadSequence
    FROM messages m JOIN messages root ON root.id=m.thread_root_id
    LEFT JOIN message_receipts mr ON mr.message_id=m.id AND mr.user_id=?
    WHERE m.room_id=? AND m.thread_root_id IS NOT NULL
    AND (root.is_encrypted=0 OR root.user_id=? OR EXISTS (SELECT 1 FROM message_envelopes e WHERE e.message_id=root.id AND e.target_user_id=? AND e.target_device_id=?))
    AND (m.is_encrypted=0 OR m.user_id=? OR EXISTS (SELECT 1 FROM message_envelopes e WHERE e.message_id=m.id AND e.target_user_id=? AND e.target_device_id=?))
    GROUP BY m.thread_root_id`)
    .all(
      userId,
      userId,
      userId,
      roomId,
      userId,
      userId,
      deviceId,
      userId,
      userId,
      deviceId,
    ) as Array<Omit<ThreadSummary, 'lastReplyAt'> & { lastReplyAt: number }>
  return Object.fromEntries(
    rows.map((row) => [row.rootId, { ...row, lastReplyAt: chatTimestampIso(row.lastReplyAt) }]),
  )
}
