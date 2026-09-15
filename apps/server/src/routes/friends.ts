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
import { redisPlugin } from '../plugins/redis.ts'

export const friendRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(redisPlugin)

  .post(
    '/add-other',
    async ({ body, user, redisService }) => {
      const { other } = body
      const me = requireUser(user)

      if (other === me.username) {
        throw createValidationError('You cannot add yourself to your own list of others.')
      }

      const otherExists = await handleAsyncOperation(
        () => redisService.checkUserExists(other),
        'Failed to check other user existence',
        ErrorCode.DATABASE_ERROR,
      )
      if (!otherExists) {
        throw createUserNotFoundError(other)
      }

      if (await redisService.hasContact(me.username, other)) {
        throw createDuplicateItemError('User is already in the list.')
      }

      await handleAsyncOperation(
        () => redisService.addContact(me.username, other),
        'Failed to add item',
        ErrorCode.DATABASE_ERROR,
      )

      return other
    },
    { body: addContactSchema },
  )

  .post(
    '/remove-other',
    async ({ body, user, redisService }) => {
      const { other } = body
      const me = requireUser(user)

      const removedCount = await handleAsyncOperation(
        () => redisService.removeContact(me.username, other),
        'Failed to remove item',
        ErrorCode.DATABASE_ERROR,
      )
      if (removedCount === 0) {
        throw createNotFoundError('Item', { item: other })
      }

      return { other, count: removedCount }
    },
    { body: addContactSchema },
  )

  .get('/get-others', async ({ user, redisService }) => {
    const me = requireUser(user)

    return handleAsyncOperation(
      () => redisService.getContacts(me.username),
      'Failed to retrieve items',
      ErrorCode.DATABASE_ERROR,
    )
  })
