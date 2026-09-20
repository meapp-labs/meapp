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
// Form Schemas (Client inputs)
// ─────────────────────────────────────────────────────────────

export const loginFormSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
  })
  .refine((data) => !data.password.includes(data.username), {
    message: 'Password cannot contain the username.',
    path: ['password'],
  })

export type LoginFormInput = z.infer<typeof loginFormSchema>

export const registerFormSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => !data.password.includes(data.username), {
    message: 'Password cannot contain the username.',
    path: ['password'],
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export type RegisterFormInput = z.infer<typeof registerFormSchema>

// ─────────────────────────────────────────────────────────────
// Auth Schemas (API payloads)
// ─────────────────────────────────────────────────────────────

export const platformSchema = z.enum(['android', 'ios', 'web'])
export type Platform = z.infer<typeof platformSchema>

export const loginSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    platform: platformSchema.optional().default('web'),
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
    platform: platformSchema.optional().default('web'),
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

// Backward compatibility aliases for forms
export const LoginSchema = loginFormSchema
export type LoginType = LoginFormInput

export const RegisterSchema = registerFormSchema
export type RegisterType = RegisterFormInput

export const pushTokenSchema = z.object({
  token: z.string().min(1, 'Push token is required'),
})

export type PushTokenInput = z.infer<typeof pushTokenSchema>
