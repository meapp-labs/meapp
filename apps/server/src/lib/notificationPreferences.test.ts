import { beforeAll, expect, test } from 'bun:test'
import { getDbInstance, runMigrations } from '@meapp/db'
import { defaultNotificationSettings } from '@meapp/shared'
import { notificationAllowed } from './notificationPreferences'
import { createPushQueue } from './pushQueue'
beforeAll(() => runMigrations())
test('notification controls suppress muted chats, quiet hours, disabled categories and removed memberships', () => {
  const db = getDbInstance().sqlite
  const id = crypto.randomUUID()
  const room = crypto.randomUUID()
  const token = `ExponentPushToken[${id}]`
  db.query(
    'INSERT INTO users (id, username, password_hash, push_token, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, id, 'unused', token, 1)
  db.query('INSERT INTO rooms (id, name, type, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
    room,
    'Mute test',
    'group',
    id,
    1,
  )
  db.query('INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)').run(
    room,
    id,
    1,
  )
  const push = {
    expoPushToken: token,
    senderUsername: 'sender',
    messageText: 'New message',
    messageIndex: 1,
    timestamp: new Date().toISOString(),
    conversationId: room,
  }
  expect(notificationAllowed(db, push)).toBe(true)
  db.query('UPDATE room_members SET muted = 1 WHERE room_id = ? AND user_id = ?').run(room, id)
  expect(notificationAllowed(db, push)).toBe(false)
  db.query('UPDATE room_members SET muted = 0 WHERE room_id = ? AND user_id = ?').run(room, id)
  const save = (patch: Partial<typeof defaultNotificationSettings>) =>
    db
      .query(
        'INSERT INTO notification_preferences VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings',
      )
      .run(id, JSON.stringify({ ...defaultNotificationSettings, ...patch }))
  save({ messages: false })
  expect(notificationAllowed(db, push)).toBe(false)
  expect(
    notificationAllowed(db, {
      expoPushToken: token,
      senderUsername: 'sender',
      messageText: 'Friend request',
      messageIndex: 1,
      timestamp: push.timestamp,
      kind: 'friend_request',
    }),
  ).toBe(true)
  save({ quietHours: true, quietStart: 0, quietEnd: 0 })
  expect(notificationAllowed(db, push)).toBe(false)
  save({})
  db.query('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(room, id)
  expect(notificationAllowed(db, push)).toBe(false)
})
test('queued notifications recheck preferences before dispatch', async () => {
  let allowed = true
  let sent = 0
  const queue = createPushQueue({
    allowed: () => allowed,
    invalidateToken() {},
    fetch: async () => {
      sent++
      return Response.json({ data: [] })
    },
  })
  queue.enqueue({
    expoPushToken: 'ExponentPushToken[queued]',
    senderUsername: 'sender',
    messageText: 'New message',
    messageIndex: 1,
    timestamp: new Date().toISOString(),
  })
  allowed = false
  await queue.flush()
  queue.stop()
  expect(sent).toBe(0)
})
