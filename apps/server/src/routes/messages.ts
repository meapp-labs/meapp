import {
  and,
  asc,
  count,
  desc,
  eq,
  getDbInstance,
  gt,
  inArray,
  insertMessageWithSequence,
  lt,
  schema,
  sql,
} from '@meapp/db'
import {
  CIPHERTEXT_TYPE_PRE_KEY,
  CIPHERTEXT_TYPE_WHISPER,
  type Conversation,
  E2E_CIPHERTEXT_MAX,
  createConversationSchema,
} from '@meapp/shared'
import { Elysia, t } from 'elysia'

import { canAccessRoom } from '../lib/authz.ts'
import { isE2EEnabled } from '../lib/config.ts'
import { chatTimestampIso } from '../lib/dbTime.ts'
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
import { broadcastToRoom } from '../ws/chat.ts'

// Phase 10: a message is either plaintext (`text`, transition/groups) or E2E
// (`ciphertext` + type + deviceId). Exactly one of the two must be present.
const sendMessageBody = t.Union([
  t.Object({
    conversationId: t.String({ format: 'uuid' }),
    text: t.String({ minLength: 1, maxLength: 2000 }),
    clientId: t.Optional(t.String({ format: 'uuid' })),
  }),
  t.Object({
    conversationId: t.String({ format: 'uuid' }),
    ciphertext: t.String({ minLength: 1, maxLength: E2E_CIPHERTEXT_MAX }),
    ciphertextType: t.Union([
      t.Literal(CIPHERTEXT_TYPE_WHISPER),
      t.Literal(CIPHERTEXT_TYPE_PRE_KEY),
    ]),
    deviceId: t.String({ format: 'uuid' }),
    clientId: t.Optional(t.String({ format: 'uuid' })),
  }),
])

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
          getDbInstance()
            .db.select()
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
        let existingDmId: string | undefined
        const [first, second] = allParticipantUsernames
        if (allParticipantUsernames.length !== 2 || !first || !second) {
          throw createValidationError('DM must have exactly 2 participants')
        }

        const u1 = userRecords.find((u) => u.username === first)
        const u2 = userRecords.find((u) => u.username === second)

        if (!u1 || !u2) {
          throw createValidationError('Participants not found')
        }

        // Single grouped query for the existing DM room (no N+1):
        // a 2-member room containing exactly these two users.
        const existingRows = getDbInstance()
          .sqlite.query(
            `SELECT r.id, r.name, r.created_at as createdAt
             FROM rooms r
             JOIN room_members rm ON rm.room_id = r.id
             WHERE rm.user_id IN (?, ?)
             GROUP BY r.id
             HAVING COUNT(DISTINCT rm.user_id) = 2 AND COUNT(*) = 2
             LIMIT 1`,
          )
          .get(u1.id, u2.id) as { id: string; name: string; createdAt: number } | undefined

        if (existingRows) {
          return {
            id: existingRows.id,
            participants: [first, second],
            isGroup: false,
            name: existingRows.name,
            createdAt: chatTimestampIso(existingRows.createdAt),
          } satisfies Conversation
        }

        // Transaction: lookup + insert atomic, so two concurrent DM requests
        // cannot both miss and create duplicate rooms.
        const roomId = Bun.randomUUIDv7()
        const dmName = name ?? `${first} & ${second}`

        getDbInstance().sqlite.transaction(() => {
          const rerun = getDbInstance()
            .sqlite.query(
              `SELECT r.id FROM rooms r
               JOIN room_members rm ON rm.room_id = r.id
               WHERE rm.user_id IN (?, ?)
               GROUP BY r.id
               HAVING COUNT(DISTINCT rm.user_id) = 2 AND COUNT(*) = 2
               LIMIT 1`,
            )
            .get(u1.id, u2.id) as { id: string } | undefined

          if (rerun) {
            existingDmId = rerun.id
            return
          }

          getDbInstance()
            .sqlite.query(
              'INSERT INTO rooms (id, name, created_by, created_at) VALUES (?, ?, ?, ?)',
            )
            .run(roomId, dmName, me.id, Math.floor(Date.now() / 1000))
          const insertMember = getDbInstance().sqlite.query(
            'INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
          )
          insertMember.run(roomId, u1.id, 'member', Math.floor(Date.now() / 1000))
          insertMember.run(roomId, u2.id, 'member', Math.floor(Date.now() / 1000))
        })()

        if (existingDmId) {
          const existingRoom = await getDbInstance()
            .db.select()
            .from(schema.rooms)
            .where(eq(schema.rooms.id, existingDmId))
            .get()
          return {
            id: existingDmId,
            participants: [first, second],
            isGroup: false,
            name: existingRoom?.name ?? dmName,
            createdAt: existingRoom
              ? chatTimestampIso(existingRoom.createdAt)
              : new Date().toISOString(),
          } satisfies Conversation
        }

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

      await getDbInstance().db.insert(schema.rooms).values({
        id: roomId,
        name: groupName,
        createdBy: me.id,
      })

      await getDbInstance()
        .db.insert(schema.roomMembers)
        .values(
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
        getDbInstance()
          .db.select({ roomId: schema.roomMembers.roomId })
          .from(schema.roomMembers)
          .where(eq(schema.roomMembers.userId, me.id)),
      'Failed to load conversations',
      ErrorCode.DATABASE_ERROR,
    )

    if (memberships.length === 0) {
      return []
    }

    const roomIds = memberships.map((m) => m.roomId)
    const rooms = await getDbInstance()
      .db.select()
      .from(schema.rooms)
      .where(inArray(schema.rooms.id, roomIds))

    const allMembers = await getDbInstance()
      .db.select({
        roomId: schema.roomMembers.roomId,
        username: schema.users.username,
      })
      .from(schema.roomMembers)
      .innerJoin(schema.users, eq(schema.roomMembers.userId, schema.users.id))
      .where(inArray(schema.roomMembers.roomId, roomIds))

    // Single query for last messages across all candidate rooms (eliminates N+1)
    const placeholders = roomIds.map(() => '?').join(',')
    const lastMessages = getDbInstance()
      .sqlite.query(
        `SELECT m.room_id as roomId, m.text, m.is_encrypted as isEncrypted, m.created_at as createdAt, u.username
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
      text: string | null
      isEncrypted: number
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
        createdAt: chatTimestampIso(room.createdAt),
        ...(lastMsg
          ? {
              // Encrypted messages are never previewed in plaintext.
              lastMessagePreview: lastMsg.isEncrypted ? 'Encrypted message' : (lastMsg.text ?? ''),
              lastMessageAt: chatTimestampIso(lastMsg.createdAt),
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
      const me = requireUser(user)
      const conversationId = body.conversationId
      const isE2E = 'ciphertext' in body

      if (isE2E && !isE2EEnabled()) {
        throw createValidationError('E2E messaging is not enabled')
      }

      // Sender must own the device they claim the ciphertext came from,
      // or the fromDeviceId metadata could be spoofed to frame another device.
      if (isE2E) {
        const device = await getDbInstance()
          .db.select({ deviceId: schema.devices.deviceId })
          .from(schema.devices)
          .where(and(eq(schema.devices.userId, me.id), eq(schema.devices.deviceId, body.deviceId)))
          .get()
        if (!device) {
          throw createValidationError('deviceId is not registered to your account')
        }
      }

      const canAccess = await canAccessRoom(me.id, conversationId)
      if (!canAccess) {
        throw createAuthError('You are not a participant in this conversation')
      }

      const conversation = await getDbInstance()
        .db.select()
        .from(schema.rooms)
        .where(eq(schema.rooms.id, conversationId))
        .get()
      if (!conversation) {
        throw createNotFoundError('Conversation')
      }

      const msgClientId = body.clientId ?? Bun.randomUUIDv7()

      const result = await insertMessageWithSequence(getDbInstance().sqlite, {
        roomId: conversationId,
        userId: me.id,
        clientId: msgClientId,
        ...(isE2E
          ? {
              ciphertext: body.ciphertext,
              ciphertextType: body.ciphertextType,
              deviceId: body.deviceId,
            }
          : { text: body.text }),
      })

      if (!result) {
        throw new Error('Failed to insert message')
      }

      const timestamp = new Date().toISOString()

      // Look up other participants' push tokens
      const otherMembers = await getDbInstance()
        .db.select({
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
            // Server never sees E2E plaintext — push preview is generic.
            messageText: isE2E ? 'Encrypted message' : body.text,
            messageIndex: result.sequence,
            timestamp,
          })
        }
      }

      await broadcastToRoom(
        conversationId,
        JSON.stringify({
          type: 'message',
          payload: {
            id: result.id,
            clientId: msgClientId,
            roomId: conversationId,
            userId: me.id,
            from: me.username,
            sequence: result.sequence,
            ...(isE2E
              ? {
                  ciphertext: body.ciphertext,
                  ciphertextType: body.ciphertextType,
                  fromDeviceId: body.deviceId,
                }
              : { text: body.text }),
            createdAt: timestamp,
          },
        }),
      )

      return {
        id: result.id,
        sequence: result.sequence,
        index: result.sequence,
        from: me.username,
        ...(isE2E
          ? {
              ciphertext: body.ciphertext,
              ciphertextType: body.ciphertextType,
              fromDeviceId: body.deviceId,
            }
          : { text: body.text }),
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
      const filteredCountRow = await getDbInstance()
        .db.select({ total: count() })
        .from(schema.messages)
        .where(whereClause)
        .get()

      const filteredTotal = filteredCountRow?.total ?? 0

      const rows = await getDbInstance()
        .db.select({
          id: schema.messages.id,
          sequence: schema.messages.sequence,
          text: schema.messages.text,
          ciphertext: schema.messages.ciphertext,
          ciphertextType: schema.messages.ciphertextType,
          isEncrypted: schema.messages.isEncrypted,
          fromDeviceId: schema.messages.deviceId,
          createdAt: schema.messages.createdAt,
          from: schema.users.username,
        })
        .from(schema.messages)
        .innerJoin(schema.users, eq(schema.messages.userId, schema.users.id))
        .where(whereClause)
        .orderBy(
          afterIndex === undefined ? desc(schema.messages.sequence) : asc(schema.messages.sequence),
        )
        .limit(limit)

      // History pages fetch the latest window, then return it in ascending order.
      const orderedRows = afterIndex === undefined ? rows.reverse() : rows
      const messages = orderedRows.map((r) => ({
        id: r.id,
        index: r.sequence,
        sequence: r.sequence,
        from: r.from ?? '',
        // E2E messages carry ciphertext; plaintext during transition/groups.
        ...(r.isEncrypted
          ? {
              ciphertext: r.ciphertext ?? '',
              ciphertextType: r.ciphertextType,
              fromDeviceId: r.fromDeviceId ?? undefined,
            }
          : { text: r.text ?? '' }),
        type: 'text',
        timestamp: chatTimestampIso(r.createdAt),
      }))

      // Unfiltered count for UI display; pagination uses filteredTotal.
      const totalCountRow = await getDbInstance()
        .db.select({ total: count() })
        .from(schema.messages)
        .where(eq(schema.messages.roomId, conversationId))
        .get()

      const hasMore = messages.length === limit && filteredTotal > limit

      return { messages, hasMore, totalCount: totalCountRow?.total ?? 0 }
    },
    { query: getMessagesQuery },
  )
