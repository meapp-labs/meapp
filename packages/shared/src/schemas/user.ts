import { z } from 'zod'

import { usernameSchema } from './auth.ts'

// ─────────────────────────────────────────────────────────────
// User Schemas
// ─────────────────────────────────────────────────────────────

export const userSchema = z.object({
  username: usernameSchema,
  createdAt: z.string().datetime(),
  avatarUrl: z.string().url().optional(),
})

export type User = z.infer<typeof userSchema>

export const addContactSchema = z.object({
  other: usernameSchema,
})

export type AddContactInput = z.infer<typeof addContactSchema>
