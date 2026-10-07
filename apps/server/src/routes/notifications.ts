import { getDbInstance } from '@meapp/db'
import { conversationMuteSchema, notificationSettingsSchema } from '@meapp/shared'
import { Elysia, t } from 'elysia'
import { requireRoomInteraction } from '../lib/authz'
import { notificationSettings } from '../lib/notificationPreferences'
import { requireUser } from '../lib/session'
import { authPlugin } from '../plugins/auth'
export const notificationRoutes = new Elysia({ prefix: '/api/notifications' })
  .use(authPlugin)
  .get('/settings', ({ user }) =>
    notificationSettings(getDbInstance().sqlite, requireUser(user).id),
  )
  .patch(
    '/settings',
    ({ user, body }) => {
      getDbInstance()
        .sqlite.query(
          'INSERT INTO notification_preferences (user_id, settings) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings',
        )
        .run(requireUser(user).id, JSON.stringify(body))
      return body
    },
    { body: notificationSettingsSchema },
  )
  .get(
    '/rooms/:roomId',
    ({ user, params }) => {
      const id = requireUser(user).id
      const db = getDbInstance().sqlite
      requireRoomInteraction(id, params.roomId, db)
      const row = db
        .query('SELECT muted FROM room_members WHERE user_id = ? AND room_id = ?')
        .get(id, params.roomId) as { muted: number }
      return { muted: Boolean(row.muted) }
    },
    { params: t.Object({ roomId: t.String({ format: 'uuid' }) }) },
  )
  .patch(
    '/rooms/:roomId',
    ({ user, body, params }) => {
      const id = requireUser(user).id
      const db = getDbInstance().sqlite
      db.transaction(() => {
        requireRoomInteraction(id, params.roomId, db)
        db.query('UPDATE room_members SET muted = ? WHERE user_id = ? AND room_id = ?').run(
          Number(body.muted),
          id,
          params.roomId,
        )
      })()
      return body
    },
    { body: conversationMuteSchema, params: t.Object({ roomId: t.String({ format: 'uuid' }) }) },
  )
