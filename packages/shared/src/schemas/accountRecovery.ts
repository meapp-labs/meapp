import { z } from 'zod'
import { passwordSchema } from './auth'

export const ACCOUNT_PROOF_TTL_MS = 15 * 60 * 1000
export const accountRecoveryEmailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((email) => email.toLowerCase())
export const accountProofSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const enrollRecoveryEmailSchema = z.strictObject({
  email: accountRecoveryEmailSchema,
  currentPassword: z.string().min(1).max(1024),
})
export const verifyRecoveryEmailSchema = z.strictObject({ token: accountProofSchema })
export const requestPasswordResetSchema = z.strictObject({ email: accountRecoveryEmailSchema })
export const completePasswordResetSchema = z
  .strictObject({
    token: accountProofSchema,
    password: passwordSchema.max(1024),
    confirmPassword: z.string().max(1024),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
export const accountRecoveryStatusSchema = z.strictObject({
  enabled: z.boolean(),
  email: z.string().nullable(),
  verified: z.boolean(),
})
export const accountRecoveryAcceptedSchema = z.strictObject({
  accepted: z.literal(true),
  message: z.string(),
})
export type AccountRecoveryStatus = z.infer<typeof accountRecoveryStatusSchema>
