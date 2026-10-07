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
  createConversationSchema,
  encryptedSendSchema,
  getMessagesQuerySchema,
  sendMessageSchema,
} from '@meapp/shared'
import { Elysia } from 'elysia'

import { canAccessRoom, contactBlocked, requireRoomInteraction } from '../lib/authz.ts'
import { env, isE2EEnabled } from '../lib/config.ts'
import { chatTimestampIso } from '../lib/dbTime.ts'
import { devSeedContent } from '../lib/devSeed.ts'
import {
  ApiError,
  ErrorCode,
  createAuthError,
  createDuplicateItemError,
  createForbiddenError,
  createNotFoundError,
  createUserNotFoundError,
  createValidationError,
  handleAsyncOperation,
} from '../lib/errors.ts'
import { sendPushNotification } from '../lib/notification.ts'
import { conversationReadSummary } from '../lib/receipts.ts'
import { requireUser } from '../lib/session.ts'
import {
  getThreadSummaries,
  requireThreadRoot,
  requireThreadTarget,
  threadRecipientDevices,
} from '../lib/threads.ts'
import { authPlugin } from '../plugins/auth.ts'
import { broadcastToRoom } from '../ws/chat.ts'

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
        if (contactBlocked(u1.id, u2.id)) throw createForbiddenError('Conversation unavailable')

        // Single grouped query for the existing DM room (no N+1):
        // a 2-member room containing exactly these two users.
        const existingRows = getDbInstance()
          .sqlite.query(
            `SELECT r.id, r.name, r.created_at as createdAt
             FROM rooms r
             JOIN room_members rm ON rm.room_id = r.id
             WHERE r.type = 'dm' AND rm.user_id IN (?, ?)
             GROUP BY r.id
             HAVING COUNT(DISTINCT rm.user_id) = 2 AND COUNT(*) = 2
             LIMIT 1`,
          )
          .get(u1.id, u2.id) as { id: string; name: string; createdAt: number } | undefined

        if (existingRows) {
          return {
            id: existingRows.id,
            type: 'dm',
            participants: [first, second],
            isGroup: false,
            name: existingRows.name,
            createdAt: chatTimestampIso(existingRows.createdAt),
          } satisfies Conversation
        }

        const acceptedFriendship = getDbInstance()
          .sqlite.query('SELECT 1 FROM contacts WHERE user_id = ? AND contact_user_id = ?')
          .get(u1.id, u2.id)
        if (!acceptedFriendship) {
          throw createForbiddenError('Accept a friend request before starting a direct chat.')
        }

        // Transaction: lookup + insert atomic, so two concurrent DM requests
        // cannot both miss and create duplicate rooms.
        const roomId = Bun.randomUUIDv7()
        const dmName = name ?? `${first} & ${second}`

        getDbInstance().sqlite.transaction(() => {
          if (contactBlocked(u1.id, u2.id)) throw createForbiddenError('Conversation unavailable')
          if (
            !getDbInstance()
              .sqlite.query('SELECT 1 FROM contacts WHERE user_id = ? AND contact_user_id = ?')
              .get(u1.id, u2.id)
          ) {
            throw createForbiddenError('Accept a friend request before starting a direct chat.')
          }
          const rerun = getDbInstance()
            .sqlite.query(
              `SELECT r.id FROM rooms r
               JOIN room_members rm ON rm.room_id = r.id
               WHERE r.type = 'dm' AND rm.user_id IN (?, ?)
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
              'INSERT INTO rooms (id, name, type, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
            )
            .run(roomId, dmName, 'dm', me.id, Math.floor(Date.now() / 1000))
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
            type: 'dm',
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
          type: 'dm',
          participants: [first, second],
          isGroup: false,
          name: dmName,
          createdAt: new Date().toISOString(),
        } satisfies Conversation
      }

      // Group conversation — room and members must commit together or an
      // orphan memberless room would be permanent garbage (nothing sweeps it).
      const roomId = Bun.randomUUIDv7()
      const groupName = name ?? 'Group'
      const createdAtSeconds = Math.floor(Date.now() / 1000)

      getDbInstance().sqlite.transaction(() => {
        getDbInstance()
          .sqlite.query(
            'INSERT INTO rooms (id, name, type, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(roomId, groupName, 'group', me.id, createdAtSeconds)
        const insertMember = getDbInstance().sqlite.query(
          'INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
        )
        for (const u of userRecords) {
          if (contactBlocked(me.id, u.id)) throw createForbiddenError('Conversation unavailable')
          insertMember.run(roomId, u.id, u.id === me.id ? 'admin' : 'member', createdAtSeconds)
        }
      })()

      set.status = 201
      return {
        id: roomId,
        type: 'group',
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
        `SELECT m.id, m.room_id as roomId, m.text, m.is_encrypted as isEncrypted, m.created_at as createdAt, u.username
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
      id: string
      text: string | null
      isEncrypted: number
      createdAt: number
      username: string | null
    }>

    const lastMsgByRoom = new Map(lastMessages.map((m) => [m.roomId, m]))
    const lastIncomingMessages = getDbInstance()
      .sqlite.query(
        `SELECT m.id, m.room_id as roomId, m.sequence, m.text, m.is_encrypted as isEncrypted, m.created_at as createdAt
         FROM messages m
         WHERE (m.room_id, m.sequence) IN (
           SELECT room_id, MAX(sequence)
           FROM messages
           WHERE room_id IN (${placeholders}) AND user_id <> ?
           GROUP BY room_id
         )`,
      )
      .all(...roomIds, me.id) as Array<{
      roomId: string
      id: string
      sequence: number
      text: string | null
      isEncrypted: number
      createdAt: number
    }>
    const lastIncomingByRoom = new Map(lastIncomingMessages.map((m) => [m.roomId, m]))
    const conversations: Conversation[] = []

    const readSummaries = conversationReadSummary(roomIds, me.id)
    for (const room of rooms) {
      const roomParticipants = allMembers
        .filter((m) => m.roomId === room.id)
        .map((m) => m.username)
        .filter(Boolean) as string[]

      const lastMsg = lastMsgByRoom.get(room.id)
      const lastIncoming = lastIncomingByRoom.get(room.id)

      conversations.push({
        id: room.id,
        ...readSummaries.get(room.id),
        type: (room.type as 'dm' | 'group') ?? (roomParticipants.length > 2 ? 'group' : 'dm'),
        participants: roomParticipants,
        isGroup: room.type ? room.type === 'group' : roomParticipants.length > 2,
        name: room.name,
        createdAt: chatTimestampIso(room.createdAt),
        ...(lastMsg
          ? {
              // The client decrypts encrypted previews on the recipient device.
              lastMessageEncrypted: Boolean(lastMsg.isEncrypted),
              lastMessageId: lastMsg.id,
              ...(lastMsg.isEncrypted ? {} : { lastMessagePreview: lastMsg.text ?? '' }),
              lastMessageAt: chatTimestampIso(lastMsg.createdAt),
              lastMessageFrom: lastMsg.username ?? undefined,
            }
          : {}),
        ...(lastIncoming
          ? {
              lastIncomingMessageId: lastIncoming.id,
              lastIncomingMessageSequence: lastIncoming.sequence,
              lastIncomingMessageEncrypted: Boolean(lastIncoming.isEncrypted),
              ...(lastIncoming.isEncrypted
                ? {}
                : { lastIncomingMessagePreview: lastIncoming.text ?? '' }),
              lastIncomingMessageAt: chatTimestampIso(lastIncoming.createdAt),
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
      requireRoomInteraction(me.id, conversationId)

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
        if (body.threadRootId)
          requireThreadTarget(
            conversationId,
            body.threadRootId,
            body.replyTo,
            me.id,
            senderProtocolDeviceId,
          )
        const recipients = body.threadRootId
          ? threadRecipientDevices(conversationId, body.threadRootId)
              .filter((row) => row.userId !== me.id || row.deviceId !== senderProtocolDeviceId)
              .map((row) => ({ user_id: row.userId, device_id: row.deviceId }))
          : (sqlite
              .query(`SELECT ri.user_id, ri.device_id FROM room_members rm
                  JOIN relay_identities ri ON ri.user_id = rm.user_id
                  WHERE rm.room_id = ? AND NOT (ri.user_id = ? AND ri.device_id = ?)`)
              .all(conversationId, me.id, senderProtocolDeviceId) as Array<{
              user_id: string
              device_id: number
            }>)
        const memberCount = sqlite
          .query('SELECT COUNT(*) AS total FROM room_members WHERE room_id = ?')
          .get(conversationId) as { total: number }
        const encryptedMembers = sqlite
          .query(`SELECT COUNT(DISTINCT rm.user_id) AS total FROM room_members rm
                  JOIN relay_identities ri ON ri.user_id = rm.user_id WHERE rm.room_id = ?`)
          .get(conversationId) as { total: number }
        if (!body.threadRootId && memberCount.total !== encryptedMembers.total)
          throw createValidationError('A recipient has not enabled encryption')
        const existingOperation = sqlite
          .query('SELECT id FROM messages WHERE user_id=? AND client_id=?')
          .get(me.id, body.clientId)
        const key = (userId: string, deviceId: number) => `${userId}:${deviceId}`
        const expected = recipients.map((row) => key(row.user_id, row.device_id)).sort()
        const actual = body.envelopes.map((row) => key(row.targetUserId, row.targetDeviceId)).sort()
        if (
          !existingOperation &&
          (expected.length !== actual.length || expected.some((id, index) => id !== actual[index]))
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

      if (isEnvelopeSend && body.replyTo) {
        const available = getDbInstance()
          .sqlite.query(`SELECT 1 FROM messages m WHERE m.id=? AND m.room_id=?
          AND (m.is_encrypted=0 OR m.user_id=? OR EXISTS (SELECT 1 FROM message_envelopes e WHERE e.message_id=m.id AND e.target_user_id=? AND e.target_device_id=?))`)
          .get(body.replyTo, conversationId, me.id, me.id, senderProtocolDeviceId)
        if (!available)
          throw createForbiddenError('Reply target is unavailable in this conversation')
      }
      const msgClientId = body.clientId ?? Bun.randomUUIDv7()
      const attachmentIds = isEnvelopeSend ? (body.attachmentIds ?? []) : []

      let result: SequenceResult
      try {
        result = await insertMessageWithSequence(
          getDbInstance().sqlite,
          {
            roomId: conversationId,
            userId: me.id,
            clientId: msgClientId,
            attachmentIds,
            mutation: () => requireRoomInteraction(me.id, conversationId),
            ...(isEnvelopeSend && body.replyTo ? { replyTo: body.replyTo } : {}),
            ...(isEnvelopeSend && body.threadRootId ? { threadRootId: body.threadRootId } : {}),
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
                for (const attachmentId of attachmentIds) {
                  const linked = getDbInstance()
                    .sqlite.query(
                      `UPDATE attachments SET state='linked', linked_at=?, linked_to=?
                     WHERE id=? AND sender_id=? AND room_id=? AND state='committed'`,
                    )
                    .run(
                      Math.floor(Date.now() / 1000),
                      msgClientId,
                      attachmentId,
                      me.id,
                      conversationId,
                    )
                  if (linked.changes !== 1) {
                    const row = getDbInstance()
                      .sqlite.query(
                        'SELECT state FROM attachments WHERE id=? AND sender_id=? AND room_id=?',
                      )
                      .get(attachmentId, me.id, conversationId) as { state: string } | null
                    if (row?.state === 'expired' || row?.state === 'deleting')
                      throw new ApiError(
                        ErrorCode.ITEM_NOT_FOUND,
                        'Attachment expired; upload again',
                        410,
                      )
                    throw createDuplicateItemError('Attachment is unavailable or already used')
                  }
                }
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
          .db.select({ pushToken: schema.users.pushToken, userId: schema.users.id })
          .from(schema.roomMembers)
          .innerJoin(schema.users, eq(schema.roomMembers.userId, schema.users.id))
          .where(
            and(
              eq(schema.roomMembers.roomId, conversationId),
              sql`${schema.roomMembers.userId} != ${me.id}`,
            ),
          )

        const followers =
          isEnvelopeSend && body.threadRootId
            ? new Set(
                (
                  getDbInstance()
                    .sqlite.query(
                      'SELECT user_id AS userId FROM messages WHERE id=? OR thread_root_id=?',
                    )
                    .all(body.threadRootId, body.threadRootId) as { userId: string }[]
                ).map((row) => row.userId),
              )
            : null
        const audience =
          isEnvelopeSend && body.threadRootId
            ? new Set(
                threadRecipientDevices(conversationId, body.threadRootId).map((row) => row.userId),
              )
            : null
        for (const member of otherMembers) {
          if (conversation.type === 'dm' && contactBlocked(me.id, member.userId)) continue
          if (followers && (!followers.has(member.userId) || !audience?.has(member.userId)))
            continue
          if (member.pushToken) {
            void sendPushNotification({
              expoPushToken: member.pushToken,
              senderUsername: me.username,
              messageText:
                isEnvelopeSend && body.threadRootId ? 'New reply in a thread' : 'New message',
              ...(isEnvelopeSend && body.threadRootId ? { threadRootId: body.threadRootId } : {}),
              messageIndex: result.sequence,
              timestamp,
              conversationId,
            })
          }
        }

        await broadcastToRoom(
          conversationId,
          JSON.stringify(
            isEnvelopeSend && body.threadRootId
              ? {
                  type: 'thread-changed',
                  payload: { roomId: conversationId },
                }
              : {
                  type: 'message',
                  payload: {
                    id: result.id,
                    clientId: msgClientId,
                    ...(isEnvelopeSend && body.replyTo ? { replyTo: body.replyTo } : {}),
                    ...(isEnvelopeSend && body.threadRootId
                      ? { threadRootId: body.threadRootId }
                      : {}),
                    ...(attachmentIds.length ? { attachmentIds } : {}),
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
                },
          ),
        )
      }

      return {
        id: result.id,
        ...(isEnvelopeSend && body.replyTo ? { replyTo: body.replyTo } : {}),
        ...(isEnvelopeSend && body.threadRootId ? { threadRootId: body.threadRootId } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
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
    { body: sendMessageSchema },
  )

  .get(
    '/get-messages',
    async ({ query, user }) => {
      const { conversationId, after, before, threadRootId } = query
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

      if (threadRootId) requireThreadRoot(conversationId, threadRootId, me.id, readerDeviceId)
      const threadSummaries = getThreadSummaries(conversationId, me.id, readerDeviceId)
      const limit = query.limit
        ? Math.min(Number.parseInt(query.limit, 10), MAX_MESSAGE_LIMIT)
        : DEFAULT_MESSAGE_LIMIT

      const audience = getDbInstance()
        .sqlite.query(`SELECT COUNT(*) AS total, COALESCE(MAX(e.rowid),0) AS latest
        FROM message_envelopes e JOIN messages m ON m.id=e.message_id
        WHERE m.room_id=? AND e.target_user_id=? AND e.target_device_id=? AND e.source_user_id IS NOT NULL`)
        .get(conversationId, me.id, readerDeviceId) as { total: number; latest: number }
      const historyAudienceVersion = `${audience.total}:${audience.latest}`
      const afterIndex =
        after === undefined
          ? undefined
          : query.syncAudience && query.syncAudience !== historyAudienceVersion
            ? 0
            : Number.parseInt(after, 10)
      const beforeIndex = before === undefined ? undefined : Number.parseInt(before, 10)

      let whereClause = eq(schema.messages.roomId, conversationId)
      if (threadRootId)
        whereClause = and(
          whereClause,
          eq(schema.messages.threadRootId, threadRootId),
        ) as typeof whereClause
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

      const selectMessages = () =>
        getDbInstance()
          .db.select({
            id: schema.messages.id,
            clientId: schema.messages.clientId,
            attachmentIds: schema.messages.attachmentIds,
            replyTo: schema.messages.replyTo,
            threadRootId: schema.messages.threadRootId,
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
      const rows = await selectMessages()
        .where(whereClause)
        .orderBy(
          afterIndex === undefined ? desc(schema.messages.sequence) : asc(schema.messages.sequence),
        )
        .limit(limit + 1)

      const threadRoot = threadRootId
        ? await selectMessages().where(eq(schema.messages.id, threadRootId)).get()
        : undefined
      const hasMore = rows.length > limit
      const pageRows = rows.slice(0, limit)
      // History pages fetch the latest window, then return it in ascending order.
      const orderedRows = afterIndex === undefined ? pageRows.reverse() : pageRows
      const ownReads = new Set(
        (
          getDbInstance()
            .sqlite.query(`SELECT mr.message_id AS id
        FROM message_receipts mr JOIN messages m ON m.id=mr.message_id
        WHERE mr.user_id=? AND mr.read_at IS NOT NULL AND m.room_id=?
        AND m.id IN (${[...orderedRows, ...(threadRoot ? [threadRoot] : [])].map(() => '?').join(',') || 'NULL'})`)
            .all(
              me.id,
              conversationId,
              ...[...orderedRows, ...(threadRoot ? [threadRoot] : [])].map((row) => row.id),
            ) as { id: string }[]
        ).map((row) => row.id),
      )
      const pageAttachmentIds = [...orderedRows, ...(threadRoot ? [threadRoot] : [])].flatMap(
        (row) => JSON.parse(row.attachmentIds) as string[],
      )
      const availableAttachments = new Set(
        pageAttachmentIds.length
          ? (
              getDbInstance()
                .sqlite.query(`SELECT id FROM attachments WHERE id IN (${pageAttachmentIds.map(() => '?').join(',')})
          AND state='linked' AND (?=0 OR linked_at>?)`)
                .all(
                  ...pageAttachmentIds,
                  env.MEDIA_LINKED_TTL_SECONDS,
                  Math.floor(Date.now() / 1000) - env.MEDIA_LINKED_TTL_SECONDS,
                ) as { id: string }[]
            ).map((row) => row.id)
          : [],
      )
      const mapMessage = (r: (typeof rows)[number]) => ({
        id: r.id,
        acknowledgedRead: ownReads.has(r.id),
        envelopeAvailable: Boolean(r.envelopeCiphertext),
        clientId: r.clientId,
        ...(r.replyTo ? { replyTo: r.replyTo } : {}),
        ...(r.threadRootId ? { threadRootId: r.threadRootId } : {}),
        ...(r.attachmentIds !== '[]'
          ? { attachmentIds: JSON.parse(r.attachmentIds) as string[] }
          : {}),
        ...(() => {
          const ids = JSON.parse(r.attachmentIds) as string[]
          const unavailable = ids.filter((id) => !availableAttachments.has(id))
          return unavailable.length ? { unavailableAttachmentIds: unavailable } : {}
        })(),
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
          : (devSeedContent(r.clientId, r.text) ?? { text: r.text ?? '' })),
        type: 'text',
        timestamp: chatTimestampIso(r.createdAt),
      })
      const messages = orderedRows.map(mapMessage)

      // Count this view independently of its pagination cursor.
      const totalCountRow = await getDbInstance()
        .db.select({ total: count() })
        .from(schema.messages)
        .where(
          threadRootId
            ? and(
                eq(schema.messages.roomId, conversationId),
                eq(schema.messages.threadRootId, threadRootId),
              )
            : eq(schema.messages.roomId, conversationId),
        )
        .get()

      return {
        messages,
        historyAudienceVersion,
        nextAfter: orderedRows.at(-1)?.sequence ?? afterIndex ?? 0,
        threadSummaries,
        ...(threadRoot ? { threadRoot: mapMessage(threadRoot) } : {}),
        hasMore,
        totalCount: totalCountRow?.total ?? 0,
        firstUnreadSequence: threadRootId
          ? (threadSummaries[threadRootId]?.firstUnreadSequence ?? null)
          : (conversationReadSummary([conversationId], me.id).get(conversationId)
              ?.firstUnreadSequence ?? null),
      }
    },
    { query: getMessagesQuerySchema },
  )
