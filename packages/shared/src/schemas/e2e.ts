import { z } from 'zod'

// ─────────────────────────────────────────────────────────────
// E2E (Signal protocol relay) schemas — Phase 10
// ─────────────────────────────────────────────────────────────

export const E2E_CIPHERTEXT_MAX = 12 * 1024 // base64, ~8KB plaintext
export const CIPHERTEXT_TYPE_WHISPER = 1
export const CIPHERTEXT_TYPE_PRE_KEY = 3

export const deviceIdSchema = z.string().uuid()

export const deviceRegistrationSchema = z.object({
  deviceId: deviceIdSchema,
  platform: z.enum(['ios', 'android', 'web']),
  /** Signal identity public key, base64 X25519 (32 bytes). */
  identityKeyPublic: z.string().min(1).max(128),
})

export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>

export const prekeyEntrySchema = z.object({
  prekeyId: z.number().int().min(0).max(0xffffff),
  prekeyPublic: z.string().min(1).max(128),
  signedPrekeyId: z.number().int().min(0).max(0xffffff),
  signedPrekeyPublic: z.string().min(1).max(128),
  signedPrekeySignature: z.string().min(1).max(256),
  /** ISO timestamp — must be ≤ 30 days out (server-enforced). */
  signedPrekeyExpiresAt: z.string().datetime(),
  kyberPrekeyId: z.number().int().min(0).max(0xffffff),
  /** base64 ML-KEM-768 public (~1184 bytes → ~1576 base64 chars). */
  kyberPrekeyPublic: z.string().min(1).max(4096),
  kyberPrekeySignature: z.string().min(1).max(256),
  isLastResort: z.boolean().default(false),
})

export type PrekeyEntry = z.infer<typeof prekeyEntrySchema>

export const bundleUploadSchema = z.object({
  deviceId: deviceIdSchema,
  identityKeyPublic: z.string().min(1).max(128),
  prekeys: z.array(prekeyEntrySchema).min(1).max(150),
})

export type BundleUpload = z.infer<typeof bundleUploadSchema>

/** Server response for GET /api/e2e/bundle — everything needed for X3DH. */
export const prekeyBundleSchema = z.object({
  prekeyId: prekeyEntrySchema.shape.prekeyId,
  prekeyPublic: prekeyEntrySchema.shape.prekeyPublic,
  signedPrekeyId: prekeyEntrySchema.shape.signedPrekeyId,
  signedPrekeyPublic: prekeyEntrySchema.shape.signedPrekeyPublic,
  signedPrekeySignature: prekeyEntrySchema.shape.signedPrekeySignature,
  kyberPrekeyId: prekeyEntrySchema.shape.kyberPrekeyId,
  kyberPrekeyPublic: prekeyEntrySchema.shape.kyberPrekeyPublic,
  kyberPrekeySignature: prekeyEntrySchema.shape.kyberPrekeySignature,
  isLastResort: z.boolean(),
})

export type PrekeyBundle = z.infer<typeof prekeyBundleSchema>

export const bundleResponseSchema = z.object({
  userId: z.string(),
  deviceId: deviceIdSchema,
  identityKeyPublic: z.string(),
  prekeyBundle: prekeyBundleSchema.nullable(),
})

export type BundleResponse = z.infer<typeof bundleResponseSchema>

export const deviceInfoSchema = z.object({
  userId: z.string(),
  deviceId: deviceIdSchema,
  identityKeyPublic: z.string(),
  platform: z.enum(['ios', 'android', 'web']).nullable(),
  lastSeenAt: z.string().nullable(),
})

export type DeviceInfo = z.infer<typeof deviceInfoSchema>

/** Encrypted message payload — replaces `text` for E2E DMs. */
export const encryptedMessageSchema = z.object({
  conversationId: z.string().uuid(),
  clientId: z.string().uuid(),
  ciphertext: z.string().min(1).max(E2E_CIPHERTEXT_MAX),
  ciphertextType: z.union([z.literal(CIPHERTEXT_TYPE_WHISPER), z.literal(CIPHERTEXT_TYPE_PRE_KEY)]),
  deviceId: deviceIdSchema,
})

export type EncryptedMessageInput = z.infer<typeof encryptedMessageSchema>
