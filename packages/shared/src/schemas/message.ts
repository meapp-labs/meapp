import { z } from 'zod'
import { E2E_CIPHERTEXT_MAX, encryptedSendSchema } from './e2e.ts'
import { attachmentIdsSchema, mediaDescriptorSchema } from './media.ts'
import { threadSummarySchema } from './thread.ts'

// ─────────────────────────────────────────────────────────────
// Message Schemas (V7 FINAL - Sequence cursor + WS Ticket auth)
// ─────────────────────────────────────────────────────────────

export const MESSAGE_MAX_LENGTH = 2000

const messageFieldsSchema = z.object({
  id: z.string(),
  replyTo: z.string().uuid().optional(),
  threadRootId: z.string().uuid().optional(),
  clientId: z.string().optional(),
  attachmentIds: attachmentIdsSchema.optional(),
  unavailableAttachmentIds: attachmentIdsSchema.optional(),
  media: z.array(mediaDescriptorSchema).min(1).max(4).optional(),
  roomId: z.string().optional(),
  userId: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(), // V7 monotonic sequence per room
  acknowledgedRead: z.boolean().optional(),
  envelopeAvailable: z.boolean().optional(),
  text: z.string().min(1).max(MESSAGE_MAX_LENGTH).optional(),
  ciphertext: z.string().min(1).max(E2E_CIPHERTEXT_MAX).optional(),
  ciphertextType: z
    .number()
    .int()
    .refine((value): boolean => value === 1 || value === 3, 'Unknown ciphertext type')
    .optional(),
  fromDeviceId: z.string().uuid().optional(),
  fromProtocolDeviceId: z.number().int().min(1).max(5).optional(),
  envelopeSourceUserId: z.string().uuid().optional(),
  envelopeSourceDeviceId: z.number().int().min(1).max(5).optional(),
  createdAt: z.union([z.string(), z.date(), z.number()]).optional(),
  // Compatibility & UI fields across REST and WebSocket
  index: z.union([z.number(), z.string()]).optional(),
  from: z.string().optional(),
  type: z.enum(['text', 'media', 'undecryptable']).optional().default('text'),
  timestamp: z.string().optional(),
})

// Local UI messages may be optimistic or undecryptable; wire messages require identity and cursor fields.
export const messageSchema = messageFieldsSchema.refine(
  (message) =>
    (message.ciphertext !== undefined) !==
    (message.text !== undefined || Boolean(message.media?.length)),
  {
    message: 'A message must contain ciphertext or decrypted content',
  },
)

export type Message = z.infer<typeof messageSchema>

const wireFieldsSchema = messageFieldsSchema.extend({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  sequence: z.number().int().positive(),
  from: z.string().min(1),
  timestamp: z.string().datetime(),
})
export const plaintextMessageSchema = wireFieldsSchema.extend({
  text: z.string().min(1).max(MESSAGE_MAX_LENGTH),
  ciphertext: z.never().optional(),
  ciphertextType: z.never().optional(),
})
export const encryptedMessageSchema = wireFieldsSchema.extend({
  ciphertext: z.string().min(1).max(E2E_CIPHERTEXT_MAX),
  ciphertextType: z.union([z.literal(1), z.literal(3)]),
  fromDeviceId: z.string().uuid(),
  fromProtocolDeviceId: z.number().int().min(1).max(5),
  text: z.never().optional(),
  media: z.never().optional(),
})
export const wireMessageSchema = z.union([plaintextMessageSchema, encryptedMessageSchema])

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  type: z.enum(['image', 'file', 'audio', 'video']),
  name: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  mimeType: z.string().optional(),
})

export type Attachment = z.infer<typeof attachmentSchema>

export const createMessageSchema = z.object({
  roomId: z.string().uuid(),
  text: z.string().min(1).max(MESSAGE_MAX_LENGTH),
  clientId: z.string().uuid(), // client-generated idempotency key
})

export type CreateMessageInput = z.infer<typeof createMessageSchema>

export const messageWsIncomingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    payload: createMessageSchema,
  }),
  z.object({ type: z.literal('typing'), payload: z.object({ roomId: z.string().uuid() }) }),
  z.object({
    type: z.literal('auth'),
    payload: z.object({
      ticket: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal('subscribe'),
    payload: z.object({ roomId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal('unsubscribe'),
    payload: z.object({ roomId: z.string().uuid() }),
  }),
])

export type MessageWsIncoming = z.infer<typeof messageWsIncomingSchema>

export const messageWsOutgoingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), payload: wireMessageSchema }),
  z.object({
    type: z.literal('typing'),
    payload: z.object({ roomId: z.string().uuid(), userId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal('ack'),
    payload: z.object({
      clientId: z.string().uuid(),
      id: z.string().uuid(),
      sequence: z.number().int().nonnegative().optional(),
    }),
  }),
  z.object({
    type: z.literal('authenticated'),
    payload: z.object({ userId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal('subscribed'),
    payload: z.object({ roomId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal('unsubscribed'),
    payload: z.object({ roomId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal('error'),
    payload: z.object({ code: z.string(), message: z.string() }),
  }),
])

export type MessageWsOutgoing = z.infer<typeof messageWsOutgoingSchema>

// ─────────────────────────────────────────────────────────────
// Query & Compatibility Schemas
// ─────────────────────────────────────────────────────────────

export const getMessagesQuerySchema = z.object({
  threadRootId: z.string().uuid().optional(),
  syncAudience: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional(),
  conversationId: z.string().uuid(),
  installId: z.string().uuid().optional(),
  after: z.string().regex(/^\d+$/).optional(),
  before: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
})

export type GetMessagesQuery = z.infer<typeof getMessagesQuerySchema>

export const sendMessageSchema = z.union([
  z.object({
    conversationId: z.string().uuid(),
    text: z.string().min(1).max(MESSAGE_MAX_LENGTH),
    clientId: z.string().uuid().optional(),
  }),
  encryptedSendSchema,
])
export type SendMessageInput = z.infer<typeof sendMessageSchema>
export type SendMessageRequest = SendMessageInput

export const messagesResponseSchema = z.object({
  historyAudienceVersion: z.string().optional(),
  threadRoot: messageSchema.optional(),
  threadSummaries: z.record(z.string(), threadSummarySchema).optional(),
  firstUnreadSequence: z.number().int().nonnegative().nullable().optional(),
  messages: z.array(messageSchema),
  nextAfter: z.number().int().nonnegative().optional(),
  hasMore: z.boolean().optional(),
  totalCount: z.number().int().nonnegative().optional(),
})

export type MessagesResponse = z.infer<typeof messagesResponseSchema>
