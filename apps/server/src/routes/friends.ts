import { and, eq, getDbInstance, schema } from '@meapp/db'
import { addContactSchema } from '@meapp/shared'
import { Elysia } from 'elysia'

import {
  ErrorCode,
  createDuplicateItemError,
  createNotFoundError,
  createUserNotFoundError,
  createValidationError,
  handleAsyncOperation,
} from '../lib/errors.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'

export const friendRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .post(
    '/add-other',
    async ({ body, user }) => {
      const { other } = body
      const me = requireUser(user)

      if (other === me.username) {
        throw createValidationError('You cannot add yourself to your own list of others.')
      }

      const otherUser = await handleAsyncOperation(
        async () =>
          getDbInstance()
            .db.select()
            .from(schema.users)
            .where(eq(schema.users.username, other))
            .get(),
        'Failed to check other user existence',
        ErrorCode.DATABASE_ERROR,
      )
      if (!otherUser) {
        throw createUserNotFoundError(other)
      }

      const hasContact = await handleAsyncOperation(
        async () =>
          getDbInstance()
            .db.select()
            .from(schema.contacts)
            .where(
              and(
                eq(schema.contacts.userId, me.id),
                eq(schema.contacts.contactUserId, otherUser.id),
              ),
            )
            .get(),
        'Failed to check contact existence',
        ErrorCode.DATABASE_ERROR,
      )
      if (hasContact) {
        throw createDuplicateItemError('User is already in the list.')
      }

      await handleAsyncOperation(
        async () =>
          getDbInstance().db.insert(schema.contacts).values({
            userId: me.id,
            contactUserId: otherUser.id,
          }),
        'Failed to add item',
        ErrorCode.DATABASE_ERROR,
      )

      return other
    },
    { body: addContactSchema },
  )

  .post(
    '/remove-other',
    async ({ body, user }) => {
      const { other } = body
      const me = requireUser(user)

      const otherUser = await handleAsyncOperation(
        async () =>
          getDbInstance()
            .db.select()
            .from(schema.users)
            .where(eq(schema.users.username, other))
            .get(),
        'Failed to check other user existence',
        ErrorCode.DATABASE_ERROR,
      )
      if (!otherUser) {
        throw createNotFoundError('Item', { item: other })
      }

      const deletedRows = await handleAsyncOperation(
        async () =>
          getDbInstance()
            .db.delete(schema.contacts)
            .where(
              and(
                eq(schema.contacts.userId, me.id),
                eq(schema.contacts.contactUserId, otherUser.id),
              ),
            )
            .returning(),
        'Failed to remove item',
        ErrorCode.DATABASE_ERROR,
      )

      if (deletedRows.length === 0) {
        throw createNotFoundError('Item', { item: other })
      }

      return { other, count: deletedRows.length }
    },
    { body: addContactSchema },
  )

  .get('/get-others', async ({ user }) => {
    const me = requireUser(user)

    const contactsList = await handleAsyncOperation(
      async () =>
        getDbInstance()
          .db.select({ username: schema.users.username })
          .from(schema.contacts)
          .innerJoin(schema.users, eq(schema.contacts.contactUserId, schema.users.id))
          .where(eq(schema.contacts.userId, me.id)),
      'Failed to retrieve items',
      ErrorCode.DATABASE_ERROR,
    )

    return contactsList.map((c) => c.username).filter(Boolean) as string[]
  })
