import { getDbInstance } from '@meapp/db'
import { acknowledgeMessagesSchema } from '@meapp/shared'
import { Elysia } from 'elysia'
import { canAccessRoom } from '../lib/authz.ts'
import { isE2EEnabled } from '../lib/config.ts'
import { createAuthError, createForbiddenError } from '../lib/errors.ts'
import { messageRepository } from '../lib/repos/messages.ts'
import { acknowledgeReads } from '../lib/repos/receipts.ts'
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
      const linkedDeviceId = messageRepository(sqlite).deviceId(me.id, body.installId ?? '')
      if (!linkedDeviceId) throw createAuthError('An encrypted device is required')
      deviceId = linkedDeviceId
    }
    acknowledgeReads(sqlite, body.conversationId, me.id, deviceId, body.messageIds)
    return { acknowledged: body.messageIds.length }
  },
  { body: acknowledgeMessagesSchema },
)
