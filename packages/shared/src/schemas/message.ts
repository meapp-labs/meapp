import { z } from 'zod'
import { E2E_CIPHERTEXT_MAX, encryptedSendSchema } from './e2e.ts'

// ─────────────────────────────────────────────────────────────
// Message Schemas (V7 FINAL - Sequence cursor + WS Ticket auth)
// ─────────────────────────────────────────────────────────────

export const MESSAGE_MAX_LENGTH = 2000

export const messageSchema = z
  .object({
    id: z.string(),
    clientId: z.string().optional(),
    roomId: z.string().optional(),
    userId: z.string().optional(),
    sequence: z.number().int().nonnegative().optional(), // V7 monotonic sequence per room
    text: z.string().min(1).max(MESSAGE_MAX_LENGTH).optional(),
    ciphertext: z.string().min(1).max(E2E_CIPHERTEXT_MAX).optional(),
    ciphertextType: z.number().int().optional(),
    fromDeviceId: z.string().uuid().optional(),
    fromProtocolDeviceId: z.number().int().min(1).max(5).optional(),
    envelopeSourceUserId: z.string().uuid().optional(),
    envelopeSourceDeviceId: z.number().int().min(1).max(5).optional(),
    createdAt: z.union([z.string(), z.date(), z.number()]).optional(),
    // Compatibility & UI fields across REST and WebSocket
    index: z.union([z.number(), z.string()]).optional(),
    from: z.string().optional(),
    type: z.string().optional().default('text'),
    timestamp: z.string().optional(),
  })
  .refine((message) => (message.text === undefined) !== (message.ciphertext === undefined), {
    message: 'A message must contain either text or ciphertext',
  })

export type Message = z.infer<typeof messageSchema>

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
      ticket: z.string().optional(),
      token: z.string().optional(),
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
  z.object({ type: z.literal('message'), payload: messageSchema }),
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
  messages: z.array(messageSchema),
  nextAfter: z.number().int().nonnegative().optional(),
  hasMore: z.boolean().optional(),
  totalCount: z.number().int().nonnegative().optional(),
})

export type MessagesResponse = z.infer<typeof messagesResponseSchema>
