import type { Database } from 'bun:sqlite'

export function messageRepository(sqlite: Database) {
  return {
    latestMessages(roomIds: string[]) {
      if (!roomIds.length) return []
      return sqlite
        .query(`SELECT m.id,m.room_id AS roomId,m.text,m.is_encrypted AS isEncrypted,
        m.created_at AS createdAt,u.username FROM messages m JOIN users u ON m.user_id=u.id
        WHERE (m.room_id,m.sequence) IN (SELECT room_id,MAX(sequence) FROM messages
        WHERE room_id IN (${roomIds.map(() => '?').join(',')}) GROUP BY room_id)`)
        .all(...roomIds) as {
        id: string
        roomId: string
        text: string | null
        isEncrypted: number
        createdAt: number
        username: string | null
      }[]
    },
    latestIncomingMessages(roomIds: string[], userId: string) {
      if (!roomIds.length) return []
      return sqlite
        .query(`SELECT m.id,m.room_id AS roomId,m.sequence,m.text,
        m.is_encrypted AS isEncrypted,m.created_at AS createdAt FROM messages m
        WHERE (m.room_id,m.sequence) IN (SELECT room_id,MAX(sequence) FROM messages
        WHERE room_id IN (${roomIds.map(() => '?').join(',')}) AND user_id<>? GROUP BY room_id)`)
        .all(...roomIds, userId) as {
        id: string
        roomId: string
        sequence: number
        text: string | null
        isEncrypted: number
        createdAt: number
      }[]
    },
    deviceId(userId: string, installId: string): number | undefined {
      return (
        sqlite
          .query('SELECT device_id FROM relay_identities WHERE user_id=? AND install_id=?')
          .get(userId, installId) as { device_id: number } | null
      )?.device_id
    },
    historyAudience(roomId: string, userId: string, deviceId: number) {
      const row = sqlite
        .query(`SELECT COUNT(*) AS total, COALESCE(MAX(e.rowid),0) AS latest
        FROM message_envelopes e JOIN messages m ON m.id=e.message_id
        WHERE m.room_id=? AND e.target_user_id=? AND e.target_device_id=? AND e.source_user_id IS NOT NULL`)
        .get(roomId, userId, deviceId) as { total: number; latest: number }
      return `${row.total}:${row.latest}`
    },
    readIds(roomId: string, userId: string, ids: string[]): Set<string> {
      if (!ids.length) return new Set()
      const rows = sqlite
        .query(`SELECT mr.message_id AS id FROM message_receipts mr
        JOIN messages m ON m.id=mr.message_id WHERE mr.user_id=? AND mr.read_at IS NOT NULL
        AND m.room_id=? AND m.id IN (${ids.map(() => '?').join(',')})`)
        .all(userId, roomId, ...ids) as { id: string }[]
      return new Set(rows.map((row) => row.id))
    },
    availableAttachments(ids: string[], ttl: number): Set<string> {
      if (!ids.length) return new Set()
      const rows = sqlite
        .query(`SELECT id FROM attachments WHERE id IN (${ids.map(() => '?').join(',')})
        AND state='linked' AND (?=0 OR linked_at>?)`)
        .all(...ids, ttl, Math.floor(Date.now() / 1000) - ttl) as { id: string }[]
      return new Set(rows.map((row) => row.id))
    },
    recipientDevices(roomId: string, userId: string, deviceId: number) {
      return sqlite
        .query(`SELECT ri.user_id, ri.device_id FROM room_members rm
        JOIN relay_identities ri ON ri.user_id=rm.user_id
        WHERE rm.room_id=? AND NOT (ri.user_id=? AND ri.device_id=?)`)
        .all(roomId, userId, deviceId) as { user_id: string; device_id: number }[]
    },
    allMembersEncrypted(roomId: string): boolean {
      const row = sqlite
        .query(`SELECT COUNT(*) AS total, COUNT(DISTINCT ri.user_id) AS encrypted
        FROM room_members rm LEFT JOIN (SELECT DISTINCT user_id FROM relay_identities) ri
        ON ri.user_id=rm.user_id WHERE rm.room_id=?`)
        .get(roomId) as { total: number; encrypted: number }
      return row.total === row.encrypted
    },
    existingOperation(userId: string, clientId: string): boolean {
      return Boolean(
        sqlite
          .query('SELECT 1 FROM messages WHERE user_id=? AND client_id=?')
          .get(userId, clientId),
      )
    },
    replyAvailable(id: string, roomId: string, userId: string, deviceId: number): boolean {
      return Boolean(
        sqlite
          .query(`SELECT 1 FROM messages m WHERE m.id=? AND m.room_id=?
        AND (m.is_encrypted=0 OR m.user_id=? OR EXISTS (SELECT 1 FROM message_envelopes e
        WHERE e.message_id=m.id AND e.target_user_id=? AND e.target_device_id=?))`)
          .get(id, roomId, userId, userId, deviceId),
      )
    },
    linkAttachment(id: string, userId: string, roomId: string, clientId: string): boolean {
      return (
        sqlite
          .query(`UPDATE attachments SET state='linked',linked_at=?,linked_to=?
        WHERE id=? AND sender_id=? AND room_id=? AND state='committed'`)
          .run(Math.floor(Date.now() / 1000), clientId, id, userId, roomId).changes === 1
      )
    },
    attachmentState(id: string, userId: string, roomId: string): string | undefined {
      return (
        sqlite
          .query('SELECT state FROM attachments WHERE id=? AND sender_id=? AND room_id=?')
          .get(id, userId, roomId) as { state: string } | null
      )?.state
    },
    insertEnvelopes(
      messageId: string,
      envelopes: { targetUserId: string; targetDeviceId: number; ciphertext: string }[],
    ) {
      const insert = sqlite.query(
        'INSERT INTO message_envelopes (message_id,target_user_id,target_device_id,ciphertext) VALUES (?,?,?,?)',
      )
      for (const envelope of envelopes)
        insert.run(messageId, envelope.targetUserId, envelope.targetDeviceId, envelope.ciphertext)
    },
    threadFollowers(rootId: string): Set<string> {
      return new Set(
        (
          sqlite
            .query('SELECT user_id AS userId FROM messages WHERE id=? OR thread_root_id=?')
            .all(rootId, rootId) as { userId: string }[]
        ).map((row) => row.userId),
      )
    },
  }
}
