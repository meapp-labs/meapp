import type { Database } from 'bun:sqlite'
import {
  defaultNotificationSettings,
  notificationSettingsSchema,
  notificationsQuiet,
} from '@meapp/shared'
import type { ExpoPushNotificationOptions } from './notification'
export function notificationSettings(db: Database, userId: string) {
  const row = db
    .query('SELECT settings FROM notification_preferences WHERE user_id = ?')
    .get(userId) as { settings: string } | null
  if (!row) return defaultNotificationSettings
  try {
    return notificationSettingsSchema.parse(JSON.parse(row.settings))
  } catch {
    return { ...defaultNotificationSettings, messages: false, friendRequests: false }
  }
}
export function notificationAllowed(
  db: Database,
  options: ExpoPushNotificationOptions,
  date = new Date(),
): boolean {
  const user = db.query('SELECT id FROM users WHERE push_token = ?').get(options.expoPushToken) as {
    id: string
  } | null
  if (!user) return false
  const settings = notificationSettings(db, user.id)
  if (
    notificationsQuiet(settings, date) ||
    !(options.kind === 'friend_request' ? settings.friendRequests : settings.messages)
  )
    return false
  if (options.conversationId) {
    const member = db
      .query('SELECT muted FROM room_members WHERE user_id = ? AND room_id = ?')
      .get(user.id, options.conversationId) as { muted: number } | null
    if (!member || member.muted) return false
  }
  return true
}
