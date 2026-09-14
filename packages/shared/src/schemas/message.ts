import { z } from 'zod'

// ─────────────────────────────────────────────────────────────
// Message Schemas (V7 FINAL - Sequence cursor + WS Ticket auth)
// ─────────────────────────────────────────────────────────────

export const messageSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  sequence: z.number().int().nonnegative(), // V7 monotonic sequence per room
  text: z.string().min(1).max(4000),
  createdAt: z.coerce.date(),
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
  text: z.string().min(1).max(4000),
  clientId: z.string().uuid(), // client-generated idempotency key
})

export type CreateMessageInput = z.infer<typeof createMessageSchema>

export const messageWsIncomingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), payload: createMessageSchema }),
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
  roomId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  afterSequence: z.coerce.number().int().nonnegative().optional(), // V7 sequence cursor
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(50),
})

export type GetMessagesQuery = z.infer<typeof getMessagesQuerySchema>

export const sendMessageSchema = createMessageSchema
export type SendMessageInput = CreateMessageInput

export const messagesResponseSchema = z.object({
  messages: z.array(messageSchema),
  nextAfter: z.number().int().nonnegative().optional(),
})

export type MessagesResponse = z.infer<typeof messagesResponseSchema>
