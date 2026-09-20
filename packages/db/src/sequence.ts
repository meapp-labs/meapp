import type { Database } from 'bun:sqlite'

export type SequenceResult = { id: string; sequence: number } | null

/**
 * Inserts a message with a per-room monotonic sequence under an explicit
 * BEGIN IMMEDIATE transaction, retrying on UNIQUE(room_id, sequence)
 * collisions.
 */
export const insertMessageWithSequence = async (
  sqlite: Database,
  opts: {
    roomId: string
    userId: string
    clientId: string
    text: string
  },
): Promise<SequenceResult> => {
  // Idempotency check: if client_id exists for user, return existing record without burning a sequence
  const existing = sqlite
    .query('SELECT id, sequence FROM messages WHERE user_id = ? AND client_id = ?')
    .get(opts.userId, opts.clientId) as { id: string; sequence: number } | null

  if (existing) {
    return existing
  }

  // Retry loop for UNIQUE(roomId, sequence) collision
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const maxRow = sqlite
          .query('SELECT MAX(sequence) as maxSeq FROM messages WHERE room_id = ?')
          .get(opts.roomId) as { maxSeq: number | null }

        const nextSeq = (maxRow?.maxSeq || 0) + 1
        const id = Bun.randomUUIDv7()

        sqlite
          .query(
            'INSERT INTO messages (id, client_id, room_id, user_id, sequence, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(id, opts.clientId, opts.roomId, opts.userId, nextSeq, opts.text, Date.now())

        sqlite.exec('COMMIT')
        return { id, sequence: nextSeq }
      } catch (inner) {
        try {
          sqlite.exec('ROLLBACK')
        } catch {}
        throw inner
      }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      if (err.code === 'SQLITE_CONSTRAINT' || err.message?.includes('UNIQUE')) {
        if (attempt < 2) {
          const jitter = Math.random() * 20
          await new Promise((r) => setTimeout(r, 10 * (attempt + 1) + jitter))
          continue
        }
      }
      throw e
    }
  }

  return null
}

export const nextSequence = async (sqlite: Database, roomId: string): Promise<number> => {
  const maxRow = sqlite
    .query('SELECT MAX(sequence) as maxSeq FROM messages WHERE room_id = ?')
    .get(roomId) as { maxSeq: number | null }
  return (maxRow?.maxSeq || 0) + 1
}
