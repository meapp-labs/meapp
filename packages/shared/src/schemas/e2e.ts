import { z } from 'zod'

/** The server stores and relays these opaque SDK ciphertexts per recipient. */
export const E2E_CIPHERTEXT_MAX = 12 * 1024
export const CIPHERTEXT_TYPE_WHISPER = 1

export const encryptedSendSchema = z.object({
  conversationId: z.string().uuid(),
  clientId: z.string().uuid(),
  installId: z.string().uuid(),
  envelopes: z
    .array(
      z.object({
        targetUserId: z.string().uuid(),
        targetDeviceId: z.number().int().min(1).max(5),
        ciphertext: z.string().min(1).max(E2E_CIPHERTEXT_MAX),
      }),
    )
    .min(1)
    .max(50),
})

export type EncryptedSend = z.infer<typeof encryptedSendSchema>
