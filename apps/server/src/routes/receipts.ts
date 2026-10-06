import { getDbInstance } from '@meapp/db'
import { acknowledgeMessagesSchema } from '@meapp/shared'
import { Elysia } from 'elysia'
import { canAccessRoom } from '../lib/authz.ts'
import { isE2EEnabled } from '../lib/config.ts'
import { createAuthError, createForbiddenError, createValidationError } from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'

export const receiptRoutes = new Elysia({ prefix: '/api' }).use(authPlugin).post(
  '/read',
  async ({ user, body }) => {
    const me = requireUser(user)
    if (!(await canAccessRoom(me.id, body.conversationId)))
      throw createForbiddenError('Not a room member')
    const sqlite = getDbInstance().sqlite
    let deviceId = 1
    if (isE2EEnabled()) {
      const device = sqlite
        .query('SELECT device_id FROM relay_identities WHERE user_id=? AND install_id=?')
        .get(me.id, body.installId ?? '') as { device_id: number } | null
      if (!device) throw createAuthError('An encrypted device is required')
      deviceId = device.device_id
    }
    sqlite.transaction(() => {
      if (
        !sqlite
          .query('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?')
          .get(body.conversationId, me.id)
      )
        throw createForbiddenError('Not a room member')
      const rows = sqlite
        .query(`SELECT m.id FROM messages m WHERE m.room_id=? AND m.user_id<>?
        AND m.id IN (${body.messageIds.map(() => '?').join(',')})
        AND (m.is_encrypted=0 OR EXISTS (SELECT 1 FROM message_envelopes e
          WHERE e.message_id=m.id AND e.target_user_id=? AND e.target_device_id=?))
      `)
        .all(body.conversationId, me.id, ...body.messageIds, me.id, deviceId) as { id: string }[]
      if (rows.length !== body.messageIds.length)
        throw createValidationError('Read state contains an unavailable message')
      const now = Date.now()
      // delivered_at is a legacy required column, populated alongside private read state.
      // No delivery/read status endpoint or room broadcast exposes these records.
      const insert =
        sqlite.query(`INSERT INTO message_receipts (message_id,user_id,delivered_at,read_at)
        VALUES (?,?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=excluded.read_at
        WHERE message_receipts.read_at IS NULL`)
      for (const row of rows) insert.run(row.id, me.id, now, now)
    })()
    return { acknowledged: body.messageIds.length }
  },
  { body: acknowledgeMessagesSchema },
)
