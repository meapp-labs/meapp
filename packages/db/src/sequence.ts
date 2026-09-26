import type { Database } from 'bun:sqlite'

export type SequenceResult = { id: string; sequence: number; createdAt: number; created: boolean }

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Client ID already belongs to a different message')
    this.name = 'IdempotencyConflictError'
  }
}

export type MessageInsert = {
  roomId: string
  userId: string
  clientId: string
  /** Plaintext for unencrypted messages; omit for E2E messages. */
  text?: string
  /** base64 Signal protocol body (E2E DMs). */
  ciphertext?: string
  /** 1=Whisper, 3=PreKeyWhisper */
  ciphertextType?: number
  deviceId?: string
  senderProtocolDeviceId?: number
}

/**
 * Inserts a message with a per-room monotonic sequence under an explicit
 * BEGIN IMMEDIATE transaction, retrying on UNIQUE(room_id, sequence)
 * collisions. Idempotent on (userId, clientId).
 */
export const insertMessageWithSequence = async (
  sqlite: Database,
  opts: MessageInsert,
  afterInsert?: (messageId: string) => void,
): Promise<SequenceResult> => {
  const storedText = opts.text ?? null
  const readExisting = (): SequenceResult | null => {
    const existing = sqlite
      .query(
        'SELECT id, room_id as roomId, sequence, text, ciphertext, ciphertext_type as ciphertextType, device_id as deviceId, sender_protocol_device_id as senderProtocolDeviceId, created_at as createdAt FROM messages WHERE user_id = ? AND client_id = ?',
      )
      .get(opts.userId, opts.clientId) as {
      id: string
      roomId: string
      sequence: number
      text: string | null
      ciphertext: string | null
      ciphertextType: number | null
      deviceId: string | null
      senderProtocolDeviceId: number
      createdAt: number
    } | null
    if (!existing) return null
    if (
      existing.roomId !== opts.roomId ||
      existing.text !== storedText ||
      existing.ciphertext !== (opts.ciphertext ?? null) ||
      existing.ciphertextType !== (opts.ciphertextType ?? null) ||
      existing.deviceId !== (opts.deviceId ?? null) ||
      existing.senderProtocolDeviceId !== (opts.senderProtocolDeviceId ?? 1)
    ) {
      throw new IdempotencyConflictError()
    }
    return {
      id: existing.id,
      sequence: existing.sequence,
      createdAt: existing.createdAt,
      created: false,
    }
  }

  const existing = readExisting()
  if (existing) return existing

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

        const createdAt = Math.floor(Date.now() / 1000)
        sqlite
          .query(
            'INSERT INTO messages (id, client_id, room_id, user_id, device_id, sender_protocol_device_id, sequence, text, ciphertext, ciphertext_type, is_encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            opts.clientId,
            opts.roomId,
            opts.userId,
            opts.deviceId ?? null,
            opts.senderProtocolDeviceId ?? 1,
            nextSeq,
            storedText,
            opts.ciphertext ?? null,
            opts.ciphertextType ?? null,
            opts.ciphertext !== undefined ? 1 : 0,
            createdAt,
          )

        afterInsert?.(id)

        sqlite.exec('COMMIT')
        return { id, sequence: nextSeq, createdAt, created: true }
      } catch (inner) {
        try {
          sqlite.exec('ROLLBACK')
        } catch {}
        throw inner
      }
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      if (err.code === 'SQLITE_CONSTRAINT' || err.message?.includes('UNIQUE')) {
        const raced = readExisting()
        if (raced) return raced
        if (attempt < 2) {
          const jitter = Math.random() * 20
          await new Promise((r) => setTimeout(r, 10 * (attempt + 1) + jitter))
          continue
        }
      }
      throw e
    }
  }

  throw new Error('Failed to insert message after retries')
}
