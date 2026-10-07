import { z } from 'zod'

export const RECOVERY_CHUNK_SIZE = 500_000
export const RECOVERY_MAX_CHUNKS = 100
export const RECOVERY_MAX_BYTES = RECOVERY_CHUNK_SIZE * RECOVERY_MAX_CHUNKS
export const RECOVERY_STAGE_TTL_MS = 60 * 60 * 1000
export const RECOVERY_MAX_UPLOADS = 3
export const recoveryStatusSchema = z.object({
  available: z.boolean(),
  restorable: z.boolean().optional(),
  updatedAt: z.number().nullable(),
  ownerInstallId: z.string().nullable(),
  size: z.number(),
  maxBytes: z.number(),
  uploadExpiresAfterMs: z.number(),
  lastError: z.string().nullable().optional(),
  canUpdate: z.boolean().optional(),
})
export type RecoveryStatus = z.infer<typeof recoveryStatusSchema>

const installId = z.string().uuid()
const proofHash = z.string().regex(/^[a-f0-9]{64}$/)
const iv = z.string().regex(/^[A-Za-z0-9+/]{16}$/)
const ciphertext = z
  .string()
  .min(32)
  .max(RECOVERY_MAX_BYTES)
  .regex(/^[A-Za-z0-9+/=]+$/)
export const recoveryBackupSchema = z.object({ version: z.literal(1), iv, ciphertext })
export const recoveryUploadSchema = z.object({
  installId,
  proofHash,
  iv,
  ciphertext: ciphertext.max(650_000),
})
export const recoveryChunkSchema = z
  .object({
    installId,
    uploadId: z.string().uuid(),
    proofHash,
    iv,
    index: z
      .number()
      .int()
      .min(0)
      .max(RECOVERY_MAX_CHUNKS - 1),
    total: z.number().int().min(1).max(RECOVERY_MAX_CHUNKS),
    chunk: z
      .string()
      .min(1)
      .max(RECOVERY_CHUNK_SIZE)
      .regex(/^[A-Za-z0-9+/=]+$/),
  })
  .refine((part) => part.index < part.total, { message: 'Invalid backup chunk number' })
export const recoveryCommitSchema = z.object({ uploadId: z.string().uuid() })
export const recoveryClaimSchema = z.object({
  oldInstallId: installId,
  newInstallId: installId,
  proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})
