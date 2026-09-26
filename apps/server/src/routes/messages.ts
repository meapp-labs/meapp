import { createHash } from 'node:crypto'
import {
  IdempotencyConflictError,
  type SequenceResult,
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
  CIPHERTEXT_TYPE_WHISPER,
  type Conversation,
  E2E_CIPHERTEXT_MAX,
  createConversationSchema,
  encryptedSendSchema,
} from '@meapp/shared'
import { Elysia, t } from 'elysia'

import { canAccessRoom } from '../lib/authz.ts'
import { isE2EEnabled } from '../lib/config.ts'
import { chatTimestampIso } from '../lib/dbTime.ts'
import {
  ErrorCode,
  createAuthError,
  createDuplicateItemError,
  createNotFoundError,
  createUserNotFoundError,
  createValidationError,
  handleAsyncOperation,
} from '../lib/errors.ts'
import { sendPushNotification } from '../lib/notification.ts'
import { requireUser } from '../lib/session.ts'
import { authPlugin } from '../plugins/auth.ts'
import { broadcastToRoom } from '../ws/chat.ts'

// Plaintext is accepted only when E2E is explicitly disabled for local tests.
const sendMessageBody = t.Union([
  t.Object({
    conversationId: t.String({ format: 'uuid' }),
    text: t.String({ minLength: 1, maxLength: 2000 }),
    clientId: t.Optional(t.String({ format: 'uuid' })),
  }),
  t.Object({
    conversationId: t.String({ format: 'uuid' }),
    clientId: t.String({ format: 'uuid' }),
    installId: t.String({ format: 'uuid' }),
    envelopes: t.Array(
      t.Object({
        targetUserId: t.String({ format: 'uuid' }),
        targetDeviceId: t.Integer({ minimum: 1, maximum: 5 }),
        ciphertext: t.String({ minLength: 1, maxLength: E2E_CIPHERTEXT_MAX }),
      }),
      { minItems: 1, maxItems: 50 },
    ),
  }),
])

const getMessagesQuery = t.Object({
  conversationId: t.String({ format: 'uuid' }),
  installId: t.Optional(t.String({ format: 'uuid' })),
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
      const isEnvelopeSend = 'envelopes' in body
      const isE2E = isEnvelopeSend

      if (isEnvelopeSend) {
        const parsed = encryptedSendSchema.safeParse(body)
        if (!parsed.success) throw createValidationError('Invalid encrypted message envelope')
      }

      if (isE2E && !isE2EEnabled()) {
        throw createValidationError('E2E messaging is not enabled')
      }
      if (!isE2E && isE2EEnabled()) {
        throw createValidationError('Plaintext messaging is disabled while E2E is enabled')
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

      let envelopeDigest = ''
      let senderProtocolDeviceId = 1
      if (isEnvelopeSend) {
        const sqlite = getDbInstance().sqlite
        const linkedDevice = sqlite
          .query('SELECT device_id FROM relay_identities WHERE user_id = ? AND install_id = ?')
          .get(me.id, body.installId) as { device_id: number } | null
        if (!linkedDevice) throw createAuthError('This device has not registered encryption keys')
        senderProtocolDeviceId = linkedDevice.device_id
        const recipients = sqlite
          .query(`SELECT ri.user_id, ri.device_id FROM room_members rm
                  JOIN relay_identities ri ON ri.user_id = rm.user_id
                  WHERE rm.room_id = ? AND NOT (ri.user_id = ? AND ri.device_id = ?)`)
          .all(conversationId, me.id, senderProtocolDeviceId) as Array<{
          user_id: string
          device_id: number
        }>
        const memberCount = sqlite
          .query('SELECT COUNT(*) AS total FROM room_members WHERE room_id = ?')
          .get(conversationId) as { total: number }
        const encryptedMembers = sqlite
          .query(`SELECT COUNT(DISTINCT rm.user_id) AS total FROM room_members rm
                  JOIN relay_identities ri ON ri.user_id = rm.user_id WHERE rm.room_id = ?`)
          .get(conversationId) as { total: number }
        if (memberCount.total !== encryptedMembers.total)
          throw createValidationError('A recipient has not enabled encryption')
        const key = (userId: string, deviceId: number) => `${userId}:${deviceId}`
        const expected = recipients.map((row) => key(row.user_id, row.device_id)).sort()
        const actual = body.envelopes.map((row) => key(row.targetUserId, row.targetDeviceId)).sort()
        if (
          expected.length !== actual.length ||
          expected.some((id, index) => id !== actual[index])
        ) {
          throw createValidationError(
            'Encrypted envelopes must cover every recipient device exactly once',
          )
        }
        const canonical = [...body.envelopes]
          .sort((a, b) =>
            key(a.targetUserId, a.targetDeviceId).localeCompare(
              key(b.targetUserId, b.targetDeviceId),
            ),
          )
          .map((entry) => `${key(entry.targetUserId, entry.targetDeviceId)}:${entry.ciphertext}`)
          .join('|')
        envelopeDigest = `v1:${createHash('sha256').update(canonical).digest('hex')}`
      }

      const msgClientId = body.clientId ?? Bun.randomUUIDv7()

      let result: SequenceResult
      try {
        result = await insertMessageWithSequence(
          getDbInstance().sqlite,
          {
            roomId: conversationId,
            userId: me.id,
            clientId: msgClientId,
            ...(isEnvelopeSend
              ? {
                  ciphertext: envelopeDigest,
                  ciphertextType: CIPHERTEXT_TYPE_WHISPER,
                  deviceId: body.installId,
                  senderProtocolDeviceId,
                }
              : { text: body.text }),
          },
          isEnvelopeSend
            ? (messageId) => {
                const insertEnvelope = getDbInstance().sqlite.query(
                  'INSERT INTO message_envelopes (message_id, target_user_id, target_device_id, ciphertext) VALUES (?, ?, ?, ?)',
                )
                for (const envelope of body.envelopes) {
                  insertEnvelope.run(
                    messageId,
                    envelope.targetUserId,
                    envelope.targetDeviceId,
                    envelope.ciphertext,
                  )
                }
              }
            : undefined,
        )
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          throw createDuplicateItemError(error.message)
        }
        throw error
      }

      const timestamp = chatTimestampIso(result.createdAt)

      if (result.created) {
        const otherMembers = await getDbInstance()
          .db.select({ pushToken: schema.users.pushToken })
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
              messageText: 'New message',
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
              ...(isEnvelopeSend
                ? {
                    ciphertext: envelopeDigest,
                    ciphertextType: CIPHERTEXT_TYPE_WHISPER,
                    fromDeviceId: body.installId,
                    fromProtocolDeviceId: senderProtocolDeviceId,
                  }
                : { text: body.text }),
              createdAt: timestamp,
            },
          }),
        )
      }

      return {
        id: result.id,
        sequence: result.sequence,
        index: result.sequence,
        from: me.username,
        ...(isEnvelopeSend
          ? {
              ciphertext: envelopeDigest,
              ciphertextType: CIPHERTEXT_TYPE_WHISPER,
              fromDeviceId: body.installId,
              fromProtocolDeviceId: senderProtocolDeviceId,
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

      let readerDeviceId = 1
      if (isE2EEnabled()) {
        if (!query.installId) throw createAuthError('An encrypted device is required')
        const reader = getDbInstance()
          .sqlite.query(
            'SELECT device_id FROM relay_identities WHERE user_id = ? AND install_id = ?',
          )
          .get(me.id, query.installId) as { device_id: number } | null
        if (!reader) throw createAuthError('This device has not registered encryption keys')
        readerDeviceId = reader.device_id
      }

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

      const rows = await getDbInstance()
        .db.select({
          id: schema.messages.id,
          clientId: schema.messages.clientId,
          roomId: schema.messages.roomId,
          userId: schema.messages.userId,
          sequence: schema.messages.sequence,
          text: schema.messages.text,
          ciphertext: schema.messages.ciphertext,
          envelopeCiphertext: schema.messageEnvelopes.ciphertext,
          envelopeSourceUserId: schema.messageEnvelopes.sourceUserId,
          envelopeSourceDeviceId: schema.messageEnvelopes.sourceDeviceId,
          ciphertextType: schema.messages.ciphertextType,
          isEncrypted: schema.messages.isEncrypted,
          fromDeviceId: schema.messages.deviceId,
          fromProtocolDeviceId: schema.messages.senderProtocolDeviceId,
          createdAt: schema.messages.createdAt,
          from: schema.users.username,
        })
        .from(schema.messages)
        .innerJoin(schema.users, eq(schema.messages.userId, schema.users.id))
        .leftJoin(
          schema.messageEnvelopes,
          and(
            eq(schema.messageEnvelopes.messageId, schema.messages.id),
            eq(schema.messageEnvelopes.targetUserId, me.id),
            eq(schema.messageEnvelopes.targetDeviceId, readerDeviceId),
          ),
        )
        .where(whereClause)
        .orderBy(
          afterIndex === undefined ? desc(schema.messages.sequence) : asc(schema.messages.sequence),
        )
        .limit(limit + 1)

      const hasMore = rows.length > limit
      const pageRows = rows.slice(0, limit)
      // History pages fetch the latest window, then return it in ascending order.
      const orderedRows = afterIndex === undefined ? pageRows.reverse() : pageRows
      const messages = orderedRows.map((r) => ({
        id: r.id,
        clientId: r.clientId,
        roomId: r.roomId,
        userId: r.userId,
        index: r.sequence,
        sequence: r.sequence,
        from: r.from ?? '',
        // E2E messages carry ciphertext; plaintext during transition/groups.
        ...(r.isEncrypted
          ? {
              ciphertext: r.envelopeCiphertext ?? r.ciphertext ?? '',
              ciphertextType: r.ciphertextType,
              fromDeviceId: r.fromDeviceId ?? undefined,
              fromProtocolDeviceId: r.fromProtocolDeviceId,
              envelopeSourceUserId: r.envelopeSourceUserId ?? undefined,
              envelopeSourceDeviceId: r.envelopeSourceDeviceId ?? undefined,
            }
          : { text: r.text ?? '' }),
        type: 'text',
        timestamp: chatTimestampIso(r.createdAt),
      }))

      // Unfiltered count for UI display; the extra fetched row handles pagination.
      const totalCountRow = await getDbInstance()
        .db.select({ total: count() })
        .from(schema.messages)
        .where(eq(schema.messages.roomId, conversationId))
        .get()

      return { messages, hasMore, totalCount: totalCountRow?.total ?? 0 }
    },
    { query: getMessagesQuery },
  )
