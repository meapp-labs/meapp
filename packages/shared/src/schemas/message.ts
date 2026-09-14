import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Message Schemas
// ─────────────────────────────────────────────────────────────

export const messageTypeSchema = z.enum([
  'text',
  'image',
  'file',
  'audio',
  'video',
  'system',
]);

export type MessageType = z.infer<typeof messageTypeSchema>;

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  type: z.enum(['image', 'file', 'audio', 'video']),
  name: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  mimeType: z.string().optional(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const messageSchema = z.object({
  id: z.string().uuid(),
  /** Message index in conversation (assigned by server) */
  index: z.number().int().nonnegative(),
  from: z.string(),
  text: z.string(),
  type: messageTypeSchema,
  timestamp: z.string().datetime(),
  editedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().optional(),
  threadId: z.string().uuid().optional(),
  threadReplyCount: z.number().int().nonnegative().optional(),
  /** { "👍": ["alice", "bob"] } */
  reactions: z.record(z.string(), z.array(z.string())).optional(),
  attachments: z.array(attachmentSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Message = z.infer<typeof messageSchema>;

// ─────────────────────────────────────────────────────────────
// Request / Response Schemas
// ─────────────────────────────────────────────────────────────

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  text: z
    .string()
    .min(1, 'Message text cannot be empty')
    .max(2000, 'Message too long'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const getMessagesQuerySchema = z.object({
  conversationId: z.string().uuid(),
  after: z
    .string()
    .regex(/^\d+$/, 'Must be a non-negative integer string')
    .transform((val) => parseInt(val, 10))
    .optional(),
  before: z
    .string()
    .regex(/^[1-9]\d*$/, 'Must be a positive integer string')
    .transform((val) => parseInt(val, 10))
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, 'Must be a positive integer')
    .transform((val) => Math.min(parseInt(val, 10), 100))
    .optional()
    .default(50),
});

export type GetMessagesQuery = z.infer<typeof getMessagesQuerySchema>;

export const messagesResponseSchema = z.object({
  messages: z.array(messageSchema),
  hasMore: z.boolean(),
  totalCount: z.number().int().nonnegative(),
});

export type MessagesResponse = z.infer<typeof messagesResponseSchema>;
