import type { Database, SQLQueryBindings } from 'bun:sqlite'
import { createForbiddenError, createValidationError } from '../errors.ts'

export function acknowledgeReads(
  sqlite: Database,
  roomId: string,
  userId: string,
  deviceId: number,
  ids: string[],
) {
  if (!ids.length) return
  sqlite
    .transaction(() => {
      if (
        !sqlite
          .query('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?')
          .get(roomId, userId)
      )
        throw createForbiddenError('Not a room member')
      const rows = sqlite
        .query(`SELECT m.id FROM messages m WHERE m.room_id=? AND m.user_id<>?
      AND m.id IN (${ids.map(() => '?').join(',')})
      AND (m.is_encrypted=0 OR EXISTS (SELECT 1 FROM message_envelopes e
        WHERE e.message_id=m.id AND e.target_user_id=? AND e.target_device_id=?))`)
        .all(roomId, userId, ...ids, userId, deviceId) as { id: string }[]
      if (rows.length !== ids.length)
        throw createValidationError('Read state contains an unavailable message')
      const now = Date.now()
      const bindings: SQLQueryBindings[] = rows.flatMap((row) => [row.id, userId, now, now])
      // The legacy delivered_at column stays private; acknowledgments emit no status broadcasts.
      sqlite
        .query(`INSERT INTO message_receipts (message_id,user_id,delivered_at,read_at)
      VALUES ${rows.map(() => '(?,?,?,?)').join(',')}
      ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=excluded.read_at
      WHERE message_receipts.read_at IS NULL`)
        .run(...bindings)
    })
    .immediate()
}
