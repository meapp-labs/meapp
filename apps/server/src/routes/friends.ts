import { eq, getDbInstance, schema } from '@meapp/db'
import { addContactSchema } from '@meapp/shared'
import { Elysia } from 'elysia'

import {
  ErrorCode,
  createDuplicateItemError,
  createForbiddenError,
  createNotFoundError,
  createUserNotFoundError,
  createValidationError,
  handleAsyncOperation,
} from '../lib/errors.ts'
import { sendPushNotification } from '../lib/notification.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'

type UserRow = typeof schema.users.$inferSelect

async function findUser(username: string): Promise<UserRow> {
  const found = await handleAsyncOperation(
    () =>
      getDbInstance()
        .db.select()
        .from(schema.users)
        .where(eq(schema.users.username, username))
        .get(),
    'Failed to check user existence',
    ErrorCode.DATABASE_ERROR,
  )
  if (!found) throw createUserNotFoundError(username)
  return found
}

const exists = (sql: string, ...values: string[]): boolean =>
  Boolean(
    getDbInstance()
      .sqlite.query(sql)
      .get(...values),
  )

export const friendRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .post(
    '/add-other',
    async ({ body, user }) => {
      const me = requireUser(user)
      if (body.other === me.username)
        throw createValidationError('You cannot send yourself a friend request.')
      const other = await findUser(body.other)
      const sqlite = getDbInstance().sqlite

      sqlite.transaction(() => {
        if (
          exists(
            'SELECT 1 FROM contacts WHERE user_id = ? AND contact_user_id = ?',
            me.id,
            other.id,
          )
        ) {
          throw createDuplicateItemError('You are already friends.')
        }
        if (
          exists(
            'SELECT 1 FROM ignored_users WHERE (user_id = ? AND ignored_user_id = ?) OR (user_id = ? AND ignored_user_id = ?)',
            me.id,
            other.id,
            other.id,
            me.id,
          )
        ) {
          throw createForbiddenError('Friend request unavailable.')
        }
        if (
          exists(
            'SELECT 1 FROM friend_requests WHERE sender_id = ? AND recipient_id = ?',
            other.id,
            me.id,
          )
        ) {
          throw createDuplicateItemError('This user has sent you a request. Accept it instead.')
        }
        if (
          exists(
            'SELECT 1 FROM friend_requests WHERE sender_id = ? AND recipient_id = ?',
            me.id,
            other.id,
          )
        ) {
          throw createDuplicateItemError('Friend request already sent.')
        }
        sqlite
          .query(
            'INSERT INTO friend_requests (sender_id, recipient_id, created_at) VALUES (?, ?, ?)',
          )
          .run(me.id, other.id, Math.floor(Date.now() / 1000))
      })()

      if (other.pushToken) {
        void sendPushNotification({
          expoPushToken: other.pushToken,
          senderUsername: me.username,
          messageText: `${me.username} sent you a friend request`,
          messageIndex: 0,
          timestamp: new Date().toISOString(),
          kind: 'friend_request',
        })
      }
      return body.other
    },
    { body: addContactSchema },
  )

  .get('/friend-requests', async ({ user }) => {
    const me = requireUser(user)
    const sqlite = getDbInstance().sqlite
    const incoming = sqlite
      .query(
        'SELECT users.username FROM friend_requests JOIN users ON users.id = friend_requests.sender_id WHERE friend_requests.recipient_id = ? ORDER BY friend_requests.created_at DESC',
      )
      .all(me.id) as { username: string }[]
    const outgoing = sqlite
      .query(
        'SELECT users.username FROM friend_requests JOIN users ON users.id = friend_requests.recipient_id WHERE friend_requests.sender_id = ? ORDER BY friend_requests.created_at DESC',
      )
      .all(me.id) as { username: string }[]
    return {
      incoming: incoming.map((row) => row.username),
      outgoing: outgoing.map((row) => row.username),
    }
  })

  .post(
    '/friend-requests/accept',
    async ({ body, user }) => {
      const me = requireUser(user)
      const other = await findUser(body.other)
      const sqlite = getDbInstance().sqlite
      sqlite.transaction(() => {
        if (
          !exists(
            'SELECT 1 FROM friend_requests WHERE sender_id = ? AND recipient_id = ?',
            other.id,
            me.id,
          )
        ) {
          throw createNotFoundError('Friend request', { other: body.other })
        }
        sqlite
          .query(
            'DELETE FROM friend_requests WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)',
          )
          .run(other.id, me.id, me.id, other.id)
        const insert = sqlite.query(
          'INSERT OR IGNORE INTO contacts (user_id, contact_user_id, created_at) VALUES (?, ?, ?)',
        )
        const now = Math.floor(Date.now() / 1000)
        insert.run(me.id, other.id, now)
        insert.run(other.id, me.id, now)
      })()
      return body.other
    },
    { body: addContactSchema },
  )

  .post(
    '/friend-requests/cancel',
    async ({ body, user }) => {
      const me = requireUser(user)
      const other = await findUser(body.other)
      const deleted = getDbInstance()
        .sqlite.query('DELETE FROM friend_requests WHERE sender_id = ? AND recipient_id = ?')
        .run(me.id, other.id)
      if (deleted.changes === 0) {
        throw createNotFoundError('Friend request', { other: body.other })
      }
      return body.other
    },
    { body: addContactSchema },
  )

  .post(
    '/friend-requests/ignore',
    async ({ body, user }) => {
      const me = requireUser(user)
      if (body.other === me.username) throw createValidationError('You cannot ignore yourself.')
      const other = await findUser(body.other)
      const sqlite = getDbInstance().sqlite
      sqlite.transaction(() => {
        sqlite
          .query(
            'DELETE FROM friend_requests WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)',
          )
          .run(other.id, me.id, me.id, other.id)
        sqlite
          .query(
            'INSERT OR IGNORE INTO ignored_users (user_id, ignored_user_id, created_at) VALUES (?, ?, ?)',
          )
          .run(me.id, other.id, Math.floor(Date.now() / 1000))
      })()
      return body.other
    },
    { body: addContactSchema },
  )

  .get('/ignored-users', async ({ user }) => {
    const me = requireUser(user)
    const rows = getDbInstance()
      .sqlite.query(
        'SELECT users.username FROM ignored_users JOIN users ON users.id = ignored_users.ignored_user_id WHERE ignored_users.user_id = ? ORDER BY ignored_users.created_at DESC',
      )
      .all(me.id) as { username: string }[]
    return rows.map((row) => row.username)
  })

  .post(
    '/ignored-users/remove',
    async ({ body, user }) => {
      const me = requireUser(user)
      const other = await findUser(body.other)
      const result = getDbInstance()
        .sqlite.query('DELETE FROM ignored_users WHERE user_id = ? AND ignored_user_id = ?')
        .run(me.id, other.id)
      if (result.changes === 0) throw createNotFoundError('Ignored user', { other: body.other })
      return body.other
    },
    { body: addContactSchema },
  )

  .post(
    '/remove-other',
    async ({ body, user }) => {
      const me = requireUser(user)
      const other = await findUser(body.other)
      const sqlite = getDbInstance().sqlite
      const deleted = sqlite.transaction(() => {
        const mine = sqlite
          .query('DELETE FROM contacts WHERE user_id = ? AND contact_user_id = ?')
          .run(me.id, other.id)
        sqlite
          .query('DELETE FROM contacts WHERE user_id = ? AND contact_user_id = ?')
          .run(other.id, me.id)
        return mine.changes
      })()
      if (deleted === 0) throw createNotFoundError('Friend', { other: body.other })
      return { other: body.other, count: deleted }
    },
    { body: addContactSchema },
  )

  .get('/get-others', async ({ user }) => {
    const me = requireUser(user)
    const contactsList = await handleAsyncOperation(
      () =>
        getDbInstance()
          .db.select({ username: schema.users.username })
          .from(schema.contacts)
          .innerJoin(schema.users, eq(schema.contacts.contactUserId, schema.users.id))
          .where(eq(schema.contacts.userId, me.id)),
      'Failed to retrieve friends',
      ErrorCode.DATABASE_ERROR,
    )
    return contactsList.map((contact) => contact.username).filter(Boolean) as string[]
  })
