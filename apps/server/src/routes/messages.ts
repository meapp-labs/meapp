import { randomUUID } from 'node:crypto'
import { type Conversation, createConversationSchema } from '@meapp/shared'
import { Elysia, t } from 'elysia'

import {
  ErrorCode,
  createAuthError,
  createNotFoundError,
  createUserNotFoundError,
  createValidationError,
  handleAsyncOperation,
} from '../lib/errors.ts'
import { sendPushNotification } from '../lib/notification.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { redisPlugin } from '../plugins/redis.ts'
import type { StoredMessage } from '../services/redis.service.ts'

const sendMessageBody = t.Object({
  conversationId: t.String({ format: 'uuid' }),
  text: t.String({ minLength: 1, maxLength: 2000 }),
})

const getMessagesQuery = t.Object({
  conversationId: t.String({ format: 'uuid' }),
  after: t.Optional(t.String({ pattern: '^\\d+$' })),
  before: t.Optional(t.String({ pattern: '^[1-9]\\d*$' })),
  limit: t.Optional(t.String({ pattern: '^[1-9]\\d*$' })),
})

const DEFAULT_MESSAGE_LIMIT = 50
const MAX_MESSAGE_LIMIT = 100

export const messageRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(redisPlugin)

  .post(
    '/conversations',
    async ({ body, user, redisService, set }) => {
      const { type, participants, name } = body
      const me = requireUser(user)

      const allParticipants = participants.includes(me.username)
        ? participants
        : [me.username, ...participants]

      for (const participant of allParticipants) {
        if (participant === me.username) continue
        const exists = await redisService.checkUserExists(participant)
        if (!exists) {
          throw createUserNotFoundError(participant)
        }
      }

      if (type === 'dm') {
        const [first, second] = allParticipants
        if (allParticipants.length !== 2 || !first || !second) {
          throw createValidationError('DM must have exactly 2 participants')
        }

        const existingId = await redisService.findDmConversation(first, second)
        if (existingId) {
          return redisService.getConversation(existingId)
        }

        const conversation: Conversation = {
          id: randomUUID(),
          participants: allParticipants,
          isGroup: false,
          createdAt: new Date().toISOString(),
        }

        await redisService.createConversation(conversation)
        await redisService.setDmLookup(first, second, conversation.id)

        set.status = 201
        return conversation
      }

      const conversation: Conversation = {
        id: randomUUID(),
        participants: allParticipants,
        isGroup: true,
        ...(name ? { name } : {}),
        createdAt: new Date().toISOString(),
      }

      await redisService.createConversation(conversation)

      set.status = 201
      return conversation
    },
    { body: createConversationSchema },
  )

  .get('/conversations', async ({ user, redisService }) => {
    const me = requireUser(user)
    return redisService.getUserConversations(me.username)
  })

  .post(
    '/send-message',
    async ({ body, user, redisService }) => {
      const { conversationId, text } = body
      const me = requireUser(user)

      if (!(await redisService.isParticipant(conversationId, me.username))) {
        throw createAuthError('You are not a participant in this conversation')
      }

      const conversation = await redisService.getConversation(conversationId)
      if (!conversation) {
        throw createNotFoundError('Conversation')
      }

      const message: StoredMessage = {
        id: randomUUID(),
        from: me.username,
        text,
        type: 'text',
        timestamp: new Date().toISOString(),
      }

      const messageIndex = await redisService.getMessageCount(conversationId)
      await redisService.saveMessage(conversationId, message)

      for (const participant of conversation.participants) {
        if (participant === me.username) continue
        const pushToken = await redisService.getPushToken(participant)
        if (pushToken) {
          void sendPushNotification({
            expoPushToken: pushToken,
            senderUsername: me.username,
            messageText: text,
            messageIndex,
            timestamp: message.timestamp,
          })
        }
      }

      return { index: messageIndex, ...message }
    },
    { body: sendMessageBody },
  )

  .get(
    '/get-messages',
    async ({ query, user, redisService }) => {
      const { conversationId, after, before } = query
      const me = requireUser(user)

      if (!(await redisService.isParticipant(conversationId, me.username))) {
        throw createAuthError('You are not a participant in this conversation')
      }

      const limit = query.limit
        ? Math.min(Number.parseInt(query.limit, 10), MAX_MESSAGE_LIMIT)
        : DEFAULT_MESSAGE_LIMIT

      const totalCount = await handleAsyncOperation(
        () => redisService.getMessageCount(conversationId),
        'Failed to count messages',
        ErrorCode.DATABASE_ERROR,
      )

      const afterIndex = after === undefined ? undefined : Number.parseInt(after, 10)
      const beforeIndex = before === undefined ? undefined : Number.parseInt(before, 10)

      let start: number
      let end: number

      if (afterIndex !== undefined) {
        start = afterIndex + 1
        end = start + limit - 1
      } else if (beforeIndex !== undefined) {
        end = beforeIndex - 1
        start = Math.max(0, end - limit + 1)
      } else {
        end = -1
        start = Math.max(0, totalCount - limit)
      }

      const rawMessages = await redisService.getMessages(conversationId, start, end)
      const messages = rawMessages.map((raw, offset) => ({
        index: start + offset,
        ...(JSON.parse(raw) as StoredMessage),
      }))

      const hasMore = afterIndex !== undefined ? start + messages.length < totalCount : start > 0

      return { messages, hasMore, totalCount }
    },
    { query: getMessagesQuery },
  )
