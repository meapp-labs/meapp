import { z } from 'zod'

// ─────────────────────────────────────────────────────────────
// Message Schemas (V6 Podman Fixed)
// ─────────────────────────────────────────────────────────────

export const messageSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(), // FIX #9 - clientId in model
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
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
  z.object({ type: z.literal('auth'), payload: z.object({ token: z.string() }) }), // for native
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
    payload: z.object({ clientId: z.string().uuid(), id: z.string().uuid() }),
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
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.number().int().positive().max(100).optional().default(50),
})

export type GetMessagesQuery = z.infer<typeof getMessagesQuerySchema>

export const sendMessageSchema = createMessageSchema
export type SendMessageInput = CreateMessageInput

export const messagesResponseSchema = z.object({
  messages: z.array(messageSchema),
})

export type MessagesResponse = z.infer<typeof messagesResponseSchema>
