import { z } from 'zod'

// ─────────────────────────────────────────────────────────────
// Primitives (reused by other schemas)
// ─────────────────────────────────────────────────────────────

export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters long.')
  .max(24, 'Username must be at most 24 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores and hyphens')

export const passwordSchema = z.string().min(3, 'Password must be at least 3 characters')
// TODO: tighten for prod — min 12, complexity regex

// ─────────────────────────────────────────────────────────────
// Auth Schemas
// ─────────────────────────────────────────────────────────────

export const platformSchema = z.enum(['android', 'ios', 'web'])
export type Platform = z.infer<typeof platformSchema>

export const loginSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    platform: platformSchema,
  })
  .refine((data) => !data.password.includes(data.username), {
    message: 'Password cannot contain the username.',
    path: ['password'],
  })

export type LoginInput = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: passwordSchema,
    platform: platformSchema,
  })
  .refine((data) => !data.password.includes(data.username), {
    message: 'Password cannot contain the username.',
    path: ['password'],
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export type RegisterInput = z.infer<typeof registerSchema>

export const pushTokenSchema = z.object({
  token: z.string().min(1, 'Push token is required'),
})

export type PushTokenInput = z.infer<typeof pushTokenSchema>
