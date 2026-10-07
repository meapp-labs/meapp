import { createHash } from 'node:crypto'
import {
  IdempotencyConflictError,
  type SequenceResult,
  and,
  eq,
  insertMessageWithSequence,
  schema,
  sql,
} from '@meapp/db'
import { CIPHERTEXT_TYPE_WHISPER, encryptedSendSchema } from '@meapp/shared'
import { buildDeliveredMessage, messageRoomEvent } from '../messageDelivery.ts'
import { messageRepository } from '../repos/messages.ts'

import type { DbInstance } from '@meapp/db'
import type { SendMessageInput } from '@meapp/shared'
import { canAccessRoom, contactBlocked, requireRoomInteraction } from '../authz.ts'
import { isE2EEnabled } from '../config.ts'
import { chatTimestampIso } from '../dbTime.ts'
import {
  ApiError,
  ErrorCode,
  createAuthError,
  createDuplicateItemError,
  createForbiddenError,
  createNotFoundError,
  createValidationError,
} from '../errors.ts'
import { sendPushNotification } from '../notification.ts'
import type { SessionUser } from '../session.ts'
import { requireThreadTarget, threadRecipientDevices } from '../threads.ts'

export async function sendMessage(
  body: SendMessageInput,
  me: Pick<SessionUser, 'id' | 'username'>,
  instance: DbInstance,
  broadcastToRoom: (roomId: string, message: string) => Promise<void>,
) {
  const messages = messageRepository(instance.sqlite)
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

  const canAccess = await canAccessRoom(me.id, conversationId, instance.db)
  if (!canAccess) {
    throw createAuthError('You are not a participant in this conversation')
  }
  requireRoomInteraction(me.id, conversationId, instance.sqlite)

  const conversation = await instance.db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.id, conversationId))
    .get()
  if (!conversation) {
    throw createNotFoundError('Conversation')
  }

  let envelopeDigest = ''
  let senderProtocolDeviceId = 1
  if (isEnvelopeSend) {
    const linkedDeviceId = messages.deviceId(me.id, body.installId)
    if (!linkedDeviceId) throw createAuthError('This device has not registered encryption keys')
    senderProtocolDeviceId = linkedDeviceId
    if (body.threadRootId)
      requireThreadTarget(
        conversationId,
        body.threadRootId,
        body.replyTo,
        me.id,
        senderProtocolDeviceId,
        instance.sqlite,
      )
    const recipients = body.threadRootId
      ? threadRecipientDevices(conversationId, body.threadRootId, instance.sqlite)
          .filter((row) => row.userId !== me.id || row.deviceId !== senderProtocolDeviceId)
          .map((row) => ({ user_id: row.userId, device_id: row.deviceId }))
      : messages.recipientDevices(conversationId, me.id, senderProtocolDeviceId)
    if (!body.threadRootId && !messages.allMembersEncrypted(conversationId))
      throw createValidationError('A recipient has not enabled encryption')
    const existingOperation = messages.existingOperation(me.id, body.clientId)
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
        key(a.targetUserId, a.targetDeviceId).localeCompare(key(b.targetUserId, b.targetDeviceId)),
      )
      .map((entry) => `${key(entry.targetUserId, entry.targetDeviceId)}:${entry.ciphertext}`)
      .join('|')
    envelopeDigest = `v1:${createHash('sha256').update(canonical).digest('hex')}`
  }

  if (isEnvelopeSend && body.replyTo) {
    const available = messages.replyAvailable(
      body.replyTo,
      conversationId,
      me.id,
      senderProtocolDeviceId,
    )
    if (!available) throw createForbiddenError('Reply target is unavailable in this conversation')
  }
  const msgClientId = body.clientId ?? Bun.randomUUIDv7()
  const attachmentIds = isEnvelopeSend ? (body.attachmentIds ?? []) : []

  let result: SequenceResult
  try {
    result = await insertMessageWithSequence(
      instance.sqlite,
      {
        roomId: conversationId,
        userId: me.id,
        clientId: msgClientId,
        attachmentIds,
        mutation: () => requireRoomInteraction(me.id, conversationId, instance.sqlite),
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
              const linked = messages.linkAttachment(
                attachmentId,
                me.id,
                conversationId,
                msgClientId,
              )
              if (!linked) {
                const state = messages.attachmentState(attachmentId, me.id, conversationId)
                if (state === 'expired' || state === 'deleting')
                  throw new ApiError(
                    ErrorCode.ITEM_NOT_FOUND,
                    'Attachment expired; upload again',
                    410,
                  )
                throw createDuplicateItemError('Attachment is unavailable or already used')
              }
            }
            messages.insertEnvelopes(messageId, body.envelopes)
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
  const deliveredMessage = buildDeliveredMessage(result, {
    ...(isEnvelopeSend && body.replyTo ? { replyTo: body.replyTo } : {}),
    ...(isEnvelopeSend && body.threadRootId ? { threadRootId: body.threadRootId } : {}),
    ...(attachmentIds.length ? { attachmentIds } : {}),
    from: me.username,
    ...(isEnvelopeSend
      ? {
          ciphertext: envelopeDigest,
          ciphertextType: CIPHERTEXT_TYPE_WHISPER,
          fromDeviceId: body.installId,
          fromProtocolDeviceId: senderProtocolDeviceId,
        }
      : { text: body.text }),

    clientId: msgClientId,
    roomId: conversationId,
    userId: me.id,
  })

  if (result.created) {
    const otherMembers = await instance.db
      .select({ pushToken: schema.users.pushToken, userId: schema.users.id })
      .from(schema.roomMembers)
      .innerJoin(schema.users, eq(schema.roomMembers.userId, schema.users.id))
      .where(
        and(
          eq(schema.roomMembers.roomId, conversationId),
          sql`${schema.roomMembers.userId} != ${me.id}`,
        ),
      )

    const followers =
      isEnvelopeSend && body.threadRootId ? messages.threadFollowers(body.threadRootId) : null
    const audience =
      isEnvelopeSend && body.threadRootId
        ? new Set(
            threadRecipientDevices(conversationId, body.threadRootId, instance.sqlite).map(
              (row) => row.userId,
            ),
          )
        : null
    for (const member of otherMembers) {
      if (conversation.type === 'dm' && contactBlocked(me.id, member.userId, instance.sqlite))
        continue
      if (followers && (!followers.has(member.userId) || !audience?.has(member.userId))) continue
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

    await broadcastToRoom(conversationId, messageRoomEvent(deliveredMessage))
  }

  return deliveredMessage
}
