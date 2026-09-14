import { z } from 'zod';

import { usernameSchema } from './auth.ts';

// ─────────────────────────────────────────────────────────────
// Conversation Schemas
// ─────────────────────────────────────────────────────────────

export const conversationSchema = z.object({
  id: z.string().uuid(),
  participants: z.array(z.string()),
  isGroup: z.boolean(),
  name: z.string().max(100).optional(),
  avatarUrl: z.string().url().optional(),
  createdAt: z.string().datetime(),
  createdBy: z.string().optional(),
  lastMessageAt: z.string().datetime().optional(),
  lastMessagePreview: z.string().optional(),
  lastMessageFrom: z.string().optional(),
  /** { "alice": 42 } — last read message index per user */
  readState: z.record(z.string(), z.number().int().nonnegative()).optional(),
  mutedBy: z.array(z.string()).optional(),
  archivedBy: z.array(z.string()).optional(),
  pinnedBy: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Conversation = z.infer<typeof conversationSchema>;

// ─────────────────────────────────────────────────────────────
// Request Schemas
// ─────────────────────────────────────────────────────────────

export const createConversationSchema = z.object({
  type: z.enum(['dm', 'group']),
  participants: z.array(usernameSchema).min(1).max(50),
  name: z.string().max(100).optional(),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
