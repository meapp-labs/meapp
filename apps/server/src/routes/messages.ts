import { and, asc, count, desc, eq, getDbInstance, gt, inArray, lt, schema } from '@meapp/db'
import {
  type Conversation,
  createConversationSchema,
  getMessagesQuerySchema,
  sendMessageSchema,
} from '@meapp/shared'
import { Elysia } from 'elysia'
import { messageRepository } from '../lib/repos/messages.ts'
import { roomRepository } from '../lib/repos/rooms.ts'
import { sendMessage } from '../lib/services/sendMessage.ts'

import { canAccessRoom, contactBlocked } from '../lib/authz.ts'
import { env, isE2EEnabled } from '../lib/config.ts'
import { chatTimestampIso } from '../lib/dbTime.ts'
import { devSeedContent, devSeedPreview } from '../lib/devSeed.ts'
import {
  ErrorCode,
  createAuthError,
  createForbiddenError,
  createUserNotFoundError,
  createValidationError,
  handleAsyncOperation,
} from '../lib/errors.ts'
import { conversationReadSummary } from '../lib/receipts.ts'
import { requireUser } from '../lib/session.ts'
import { getThreadSummaries, requireThreadRoot } from '../lib/threads.ts'
import { authPlugin } from '../plugins/auth.ts'
import { broadcastToRoom } from '../ws/chat.ts'

const DEFAULT_MESSAGE_LIMIT = 50
const MAX_MESSAGE_LIMIT = 100

export const messageRoutes = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .post('/saved-messages', ({ user }) => {
    const me = requireUser(user)
    const sqlite = getDbInstance().sqlite
    const row = sqlite
      .transaction(() => {
        const existing = sqlite
          .query("SELECT id, created_at FROM rooms WHERE type = 'saved' AND created_by = ?")
          .get(me.id) as { id: string; created_at: number } | null
        if (existing) return existing
        const id = Bun.randomUUIDv7()
        const now = Math.floor(Date.now() / 1000)
        sqlite
          .query(
            "INSERT INTO rooms (id, name, type, created_by, created_at) VALUES (?, 'Saved messages', 'saved', ?, ?)",
          )
          .run(id, me.id, now)
        roomRepository(sqlite).insertMember(id, me.id, 'member', now)
        return { id, created_at: now }
      })
      .immediate()
    return {
      id: row.id,
      type: 'saved',
      name: 'Saved messages',
      participants: [me.username],
      isGroup: false,
      createdAt: chatTimestampIso(row.created_at),
    } satisfies Conversation
  })

  .post(
    '/conversations',
    async ({ body, user, set }) => {
      const { type, participants, name } = body
      const sqlite = getDbInstance().sqlite
      const rooms = roomRepository(sqlite)
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
        const existingRows = rooms.findDm(u1.id, u2.id)

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

        const acceptedFriendship = rooms.areFriends(u1.id, u2.id)
        if (!acceptedFriendship) {
          throw createForbiddenError('Accept a friend request before starting a direct chat.')
        }

        // Transaction: lookup + insert atomic, so two concurrent DM requests
        // cannot both miss and create duplicate rooms.
        const roomId = Bun.randomUUIDv7()
        const dmName = name ?? `${first} & ${second}`

        sqlite
          .transaction(() => {
            if (contactBlocked(u1.id, u2.id)) throw createForbiddenError('Conversation unavailable')
            if (!rooms.areFriends(u1.id, u2.id)) {
              throw createForbiddenError('Accept a friend request before starting a direct chat.')
            }
            const rerun = rooms.findDm(u1.id, u2.id)

            if (rerun) {
              existingDmId = rerun.id
              return
            }

            const now = Math.floor(Date.now() / 1000)
            rooms.insertRoom(roomId, dmName, 'dm', me.id, now)
            rooms.insertMember(roomId, u1.id, 'member', now)
            rooms.insertMember(roomId, u2.id, 'member', now)
          })
          .immediate()

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

      sqlite
        .transaction(() => {
          rooms.insertRoom(roomId, groupName, 'group', me.id, createdAtSeconds)
          for (const u of userRecords) {
            if (contactBlocked(me.id, u.id)) throw createForbiddenError('Conversation unavailable')
            rooms.insertMember(roomId, u.id, u.id === me.id ? 'admin' : 'member', createdAtSeconds)
          }
        })
        .immediate()

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
    const messagesRepo = messageRepository(getDbInstance().sqlite)
    const lastMessages = messagesRepo.latestMessages(roomIds)

    const lastMsgByRoom = new Map(lastMessages.map((m) => [m.roomId, m]))
    const lastIncomingMessages = messagesRepo.latestIncomingMessages(roomIds, me.id)
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
              ...(lastMsg.isEncrypted
                ? {}
                : { lastMessagePreview: devSeedPreview(lastMsg.clientId, lastMsg.text) }),
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
                : {
                    lastIncomingMessagePreview: devSeedPreview(
                      lastIncoming.clientId,
                      lastIncoming.text,
                    ),
                  }),
              lastIncomingMessageAt: chatTimestampIso(lastIncoming.createdAt),
            }
          : {}),
      })
    }

    return conversations
  })

  .post(
    '/send-message',
    ({ body, user }) => sendMessage(body, requireUser(user), getDbInstance(), broadcastToRoom),
    { body: sendMessageSchema },
  )

  .get(
    '/get-messages',
    async ({ query, user }) => {
      const { conversationId, after, before, threadRootId } = query
      const messagesRepo = messageRepository(getDbInstance().sqlite)
      const me = requireUser(user)

      let readerDeviceId = 1
      if (isE2EEnabled()) {
        if (!query.installId) throw createAuthError('An encrypted device is required')
        const deviceId = messagesRepo.deviceId(me.id, query.installId)
        if (!deviceId) throw createAuthError('This device has not registered encryption keys')
        readerDeviceId = deviceId
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

      const historyAudienceVersion = messagesRepo.historyAudience(
        conversationId,
        me.id,
        readerDeviceId,
      )
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
      const ownReads = messagesRepo.readIds(
        conversationId,
        me.id,
        [...orderedRows, ...(threadRoot ? [threadRoot] : [])].map((row) => row.id),
      )
      const pageAttachmentIds = [...orderedRows, ...(threadRoot ? [threadRoot] : [])].flatMap(
        (row) => JSON.parse(row.attachmentIds) as string[],
      )
      const availableAttachments = messagesRepo.availableAttachments(
        pageAttachmentIds,
        env.MEDIA_LINKED_TTL_SECONDS,
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
