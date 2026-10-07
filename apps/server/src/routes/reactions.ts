import { getDbInstance } from '@meapp/db'
import { type ReactionEntry, reactionOperationSchema, reactionSyncSchema } from '@meapp/shared'
import { Elysia } from 'elysia'
import { canAccessRoom } from '../lib/authz.ts'
import { isE2EEnabled } from '../lib/config.ts'
import { ApiError, ErrorCode, createAuthError, createForbiddenError } from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { broadcastToRoom } from '../ws/chat.ts'

async function authorize(userId: string, roomId: string, installId: string) {
  if (!(await canAccessRoom(userId, roomId))) throw createForbiddenError('Not a room member')
  const device = getDbInstance()
    .sqlite.query('SELECT device_id FROM relay_identities WHERE user_id=? AND install_id=?')
    .get(userId, installId) as { device_id: number } | null
  if (isE2EEnabled() && !device) throw createAuthError('An encrypted device is required')
  return device?.device_id ?? 1
}

// Original audience only, including an author's subsequently linked devices.
const visible = `EXISTS (SELECT 1 FROM messages m WHERE m.id=o.message_id AND m.room_id=o.room_id
  AND (m.is_encrypted=0 OR m.user_id=? OR EXISTS (SELECT 1 FROM message_envelopes e
    WHERE e.message_id=m.id AND e.target_user_id=? AND e.target_device_id=?)))`

export const reactionRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .post(
    '/reactions',
    async ({ user, body }) => {
      const me = requireUser(user)
      const deviceId = await authorize(me.id, body.conversationId, body.installId)
      const sqlite = getDbInstance().sqlite
      const result = sqlite
        .transaction(() => {
          const existing = sqlite
            .query(
              'SELECT revision, room_id, message_id, predecessor, emoji FROM reaction_operations WHERE user_id=? AND operation_id=?',
            )
            .get(me.id, body.operationId) as {
            revision: number
            room_id: string
            message_id: string
            predecessor: number
            emoji: string | null
          } | null
          if (existing) {
            if (
              existing.room_id !== body.conversationId ||
              existing.message_id !== body.messageId ||
              existing.predecessor !== body.predecessor ||
              existing.emoji !== body.emoji
            )
              throw new ApiError(
                ErrorCode.DUPLICATE_ITEM,
                'Operation ID belongs to another reaction',
                409,
              )
            return { revision: existing.revision, created: false }
          }
          const target = sqlite
            .query(`SELECT 1 FROM messages m WHERE m.id=? AND m.room_id=?
        AND (m.is_encrypted=0 OR m.user_id=? OR EXISTS (SELECT 1 FROM message_envelopes e WHERE e.message_id=m.id AND e.target_user_id=? AND e.target_device_id=?))`)
            .get(body.messageId, body.conversationId, me.id, me.id, deviceId)
          if (!target) throw createForbiddenError('Message is unavailable on this device')
          const current = sqlite
            .query(
              'SELECT MAX(revision) AS revision FROM reaction_operations WHERE message_id=? AND user_id=?',
            )
            .get(body.messageId, me.id) as { revision: number | null }
          if ((current.revision ?? 0) !== body.predecessor)
            throw new ApiError(
              ErrorCode.DUPLICATE_ITEM,
              'Reaction changed on another device. Refresh and try again.',
              409,
            )
          const row = sqlite
            .query(
              'INSERT INTO reaction_operations (operation_id,room_id,message_id,user_id,predecessor,emoji) VALUES (?,?,?,?,?,?) RETURNING revision',
            )
            .get(
              body.operationId,
              body.conversationId,
              body.messageId,
              me.id,
              body.predecessor,
              body.emoji,
            ) as { revision: number }
          return { revision: row.revision, created: true }
        })
        .immediate()
      if (result.created)
        await broadcastToRoom(
          body.conversationId,
          JSON.stringify({ type: 'reactions-changed', payload: { roomId: body.conversationId } }),
        )
      return { revision: result.revision }
    },
    { body: reactionOperationSchema },
  )
  .get(
    '/reactions',
    async ({ user, query }) => {
      const me = requireUser(user)
      const deviceId = await authorize(me.id, query.conversationId, query.installId)
      const sqlite = getDbInstance().sqlite
      // A history transfer can grant envelopes for targets below an existing cursor.
      // Reset that cursor when the addressed audience changes.
      const audience = sqlite
        .query(`SELECT COUNT(*) AS total, COALESCE(MAX(e.rowid),0) AS latest
        FROM message_envelopes e JOIN messages m ON m.id=e.message_id
        WHERE m.room_id=? AND e.target_user_id=? AND e.target_device_id=?`)
        .get(query.conversationId, me.id, deviceId) as { total: number; latest: number }
      const audienceVersion = `${audience.total}:${audience.latest}`
      const after = query.audience && query.audience !== audienceVersion ? 0 : query.after
      // Read a bounded immutable operation page. Null emoji is a durable removal.
      const rows = sqlite
        .query(`SELECT o.message_id AS messageId, o.user_id AS userId, u.username, o.emoji, o.revision
      FROM reaction_operations o JOIN users u ON u.id=o.user_id
      WHERE o.room_id=? AND o.revision>? AND ${visible} ORDER BY o.revision LIMIT 201`)
        .all(query.conversationId, after, me.id, me.id, deviceId) as ReactionEntry[]
      const entries = rows.slice(0, 200)
      return {
        entries,
        cursor: entries.at(-1)?.revision ?? after,
        audienceVersion,
        hasMore: rows.length > 200,
      }
    },
    { query: reactionSyncSchema },
  )
