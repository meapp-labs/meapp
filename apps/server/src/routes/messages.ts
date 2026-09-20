import {
  and,
  asc,
  count,
  db,
  eq,
  gt,
  inArray,
  insertMessageWithSequence,
  lt,
  schema,
  sql,
  sqlite,
} from '@meapp/db'
import { type Conversation, createConversationSchema } from '@meapp/shared'
import { Elysia, t } from 'elysia'

import { canAccessRoom } from '../lib/authz.ts'
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

const sendMessageBody = t.Object({
  conversationId: t.String({ format: 'uuid' }),
  text: t.String({ minLength: 1, maxLength: 2000 }),
  clientId: t.Optional(t.String({ format: 'uuid' })),
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

  .post(
    '/conversations',
    async ({ body, user, set }) => {
      const { type, participants, name } = body
      const me = requireUser(user)

      const allParticipantUsernames = participants.includes(me.username)
        ? participants
        : [me.username, ...participants]

      // Fetch all user records
      const userRecords = await handleAsyncOperation(
        async () =>
          db
            .select()
            .from(schema.users)
            .where(inArray(schema.users.username, allParticipantUsernames)),
        'Failed to query participants',
        ErrorCode.DATABASE_ERROR,
      )

      for (const participant of allParticipantUsernames) {
        if (!userRecords.some((u) => u.username === participant)) {
          throw createUserNotFoundError(participant)
        }
      }

      if (type === 'dm') {
        const [first, second] = allParticipantUsernames
        if (allParticipantUsernames.length !== 2 || !first || !second) {
          throw createValidationError('DM must have exactly 2 participants')
        }

        const u1 = userRecords.find((u) => u.username === first)
        const u2 = userRecords.find((u) => u.username === second)

        if (!u1 || !u2) {
          throw createValidationError('Participants not found')
        }

        // Check if DM room already exists between these 2 users
        const candidateRooms = await db
          .select({ roomId: schema.roomMembers.roomId })
          .from(schema.roomMembers)
          .where(eq(schema.roomMembers.userId, u1.id))

        for (const candidate of candidateRooms) {
          const members = await db
            .select()
            .from(schema.roomMembers)
            .where(eq(schema.roomMembers.roomId, candidate.roomId))
          if (members.length === 2 && members.some((m) => m.userId === u2.id)) {
            const existingRoom = await db
              .select()
              .from(schema.rooms)
              .where(eq(schema.rooms.id, candidate.roomId))
              .get()
            if (existingRoom) {
              return {
                id: existingRoom.id,
                participants: [first, second],
                isGroup: false,
                name: existingRoom.name,
                createdAt: new Date(existingRoom.createdAt).toISOString(),
              } satisfies Conversation
            }
          }
        }

        const roomId = Bun.randomUUIDv7()
        const dmName = name ?? `${first} & ${second}`

        await db.insert(schema.rooms).values({
          id: roomId,
          name: dmName,
          createdBy: me.id,
        })

        await db.insert(schema.roomMembers).values([
          { roomId, userId: u1.id, role: 'member' },
          { roomId, userId: u2.id, role: 'member' },
        ])

        set.status = 201
        return {
          id: roomId,
          participants: [first, second],
          isGroup: false,
          name: dmName,
          createdAt: new Date().toISOString(),
        } satisfies Conversation
      }

      // Group conversation
      const roomId = Bun.randomUUIDv7()
      const groupName = name ?? 'Group'

      await db.insert(schema.rooms).values({
        id: roomId,
        name: groupName,
        createdBy: me.id,
      })

      await db.insert(schema.roomMembers).values(
        userRecords.map((u) => ({
          roomId,
          userId: u.id,
          role: u.id === me.id ? 'admin' : 'member',
        })),
      )

      set.status = 201
      return {
        id: roomId,
        participants: allParticipantUsernames,
        isGroup: true,
        name: groupName,
        createdAt: new Date().toISOString(),
      } satisfies Conversation
    },
    { body: createConversationSchema },
  )

  .get('/conversations', async ({ user }) => {
    const me = requireUser(user)

    const memberships = await handleAsyncOperation(
      async () =>
        db
          .select({ roomId: schema.roomMembers.roomId })
          .from(schema.roomMembers)
          .where(eq(schema.roomMembers.userId, me.id)),
      'Failed to load conversations',
      ErrorCode.DATABASE_ERROR,
    )

    if (memberships.length === 0) {
      return []
    }

    const roomIds = memberships.map((m) => m.roomId)
    const rooms = await db.select().from(schema.rooms).where(inArray(schema.rooms.id, roomIds))

    const allMembers = await db
      .select({
        roomId: schema.roomMembers.roomId,
        username: schema.users.username,
      })
      .from(schema.roomMembers)
      .innerJoin(schema.users, eq(schema.roomMembers.userId, schema.users.id))
      .where(inArray(schema.roomMembers.roomId, roomIds))

    // Single query for last messages across all candidate rooms (eliminates N+1)
    const placeholders = roomIds.map(() => '?').join(',')
    const lastMessages = sqlite
      .query(
        `SELECT m.room_id as roomId, m.text, m.created_at as createdAt, u.username
         FROM messages m
         INNER JOIN users u ON m.user_id = u.id
         WHERE (m.room_id, m.sequence) IN (
           SELECT room_id, MAX(sequence)
           FROM messages
           WHERE room_id IN (${placeholders})
           GROUP BY room_id
         )`,
      )
      .all(...roomIds) as Array<{
      roomId: string
      text: string
      createdAt: number
      username: string | null
    }>

    const lastMsgByRoom = new Map(lastMessages.map((m) => [m.roomId, m]))
    const conversations: Conversation[] = []

    for (const room of rooms) {
      const roomParticipants = allMembers
        .filter((m) => m.roomId === room.id)
        .map((m) => m.username)
        .filter(Boolean) as string[]

      const lastMsg = lastMsgByRoom.get(room.id)

      conversations.push({
        id: room.id,
        participants: roomParticipants,
        isGroup: roomParticipants.length > 2,
        name: room.name,
        createdAt: new Date(room.createdAt).toISOString(),
        ...(lastMsg
          ? {
              lastMessagePreview: lastMsg.text,
              lastMessageAt: new Date(lastMsg.createdAt).toISOString(),
              lastMessageFrom: lastMsg.username ?? undefined,
            }
          : {}),
      })
    }

    return conversations
  })

  .post(
    '/send-message',
    async ({ body, user }) => {
      const { conversationId, text, clientId } = body
      const me = requireUser(user)

      const canAccess = await canAccessRoom(me.id, conversationId)
      if (!canAccess) {
        throw createAuthError('You are not a participant in this conversation')
      }

      const conversation = await db
        .select()
        .from(schema.rooms)
        .where(eq(schema.rooms.id, conversationId))
        .get()
      if (!conversation) {
        throw createNotFoundError('Conversation')
      }

      const msgClientId = clientId ?? Bun.randomUUIDv7()

      const result = await insertMessageWithSequence(sqlite, {
        roomId: conversationId,
        userId: me.id,
        clientId: msgClientId,
        text,
      })

      if (!result) {
        throw new Error('Failed to insert message')
      }

      const timestamp = new Date().toISOString()

      // Look up other participants' push tokens
      const otherMembers = await db
        .select({
          pushToken: schema.users.pushToken,
        })
        .from(schema.roomMembers)
        .innerJoin(schema.users, eq(schema.roomMembers.userId, schema.users.id))
        .where(
          and(
            eq(schema.roomMembers.roomId, conversationId),
            sql`${schema.roomMembers.userId} != ${me.id}`,
          ),
        )

      for (const member of otherMembers) {
        if (member.pushToken) {
          void sendPushNotification({
            expoPushToken: member.pushToken,
            senderUsername: me.username,
            messageText: text,
            messageIndex: result.sequence,
            timestamp,
          })
        }
      }

      return {
        id: result.id,
        sequence: result.sequence,
        index: result.sequence,
        from: me.username,
        text,
        type: 'text',
        timestamp,
      }
    },
    { body: sendMessageBody },
  )

  .get(
    '/get-messages',
    async ({ query, user }) => {
      const { conversationId, after, before } = query
      const me = requireUser(user)

      const canAccess = await canAccessRoom(me.id, conversationId)
      if (!canAccess) {
        throw createAuthError('You are not a participant in this conversation')
      }

      const limit = query.limit
        ? Math.min(Number.parseInt(query.limit, 10), MAX_MESSAGE_LIMIT)
        : DEFAULT_MESSAGE_LIMIT

      const afterIndex = after === undefined ? undefined : Number.parseInt(after, 10)
      const beforeIndex = before === undefined ? undefined : Number.parseInt(before, 10)

      let whereClause = eq(schema.messages.roomId, conversationId)
      if (afterIndex !== undefined) {
        whereClause = and(
          whereClause,
          gt(schema.messages.sequence, afterIndex),
        ) as typeof whereClause
      }
      if (beforeIndex !== undefined) {
        whereClause = and(
          whereClause,
          lt(schema.messages.sequence, beforeIndex),
        ) as typeof whereClause
      }

      // Count with the SAME filters as the page query, or pagination
      // cursors would report hasMore forever.
      const filteredCountRow = await db
        .select({ total: count() })
        .from(schema.messages)
        .where(whereClause)
        .get()

      const filteredTotal = filteredCountRow?.total ?? 0

      const rows = await db
        .select({
          id: schema.messages.id,
          sequence: schema.messages.sequence,
          text: schema.messages.text,
          createdAt: schema.messages.createdAt,
          from: schema.users.username,
        })
        .from(schema.messages)
        .innerJoin(schema.users, eq(schema.messages.userId, schema.users.id))
        .where(whereClause)
        .orderBy(asc(schema.messages.sequence))
        .limit(limit)

      const messages = rows.map((r) => ({
        id: r.id,
        index: r.sequence,
        sequence: r.sequence,
        from: r.from ?? '',
        text: r.text,
        type: 'text',
        timestamp: new Date(r.createdAt).toISOString(),
      }))

      // Unfiltered count for UI display; pagination uses filteredTotal.
      const totalCountRow = await db
        .select({ total: count() })
        .from(schema.messages)
        .where(eq(schema.messages.roomId, conversationId))
        .get()

      const hasMore = messages.length === limit && filteredTotal > limit

      return { messages, hasMore, totalCount: totalCountRow?.total ?? 0 }
    },
    { query: getMessagesQuery },
  )
