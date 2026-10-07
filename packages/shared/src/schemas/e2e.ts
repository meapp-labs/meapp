import { z } from 'zod'
import { attachmentIdsSchema } from './media.ts'

/** The server stores and relays these opaque SDK ciphertexts per recipient. */
export const E2E_CIPHERTEXT_MAX = 12 * 1024
export const MAX_GROUP_MEMBERS = 100
export const E2E_MAX_RECIPIENT_DEVICES = MAX_GROUP_MEMBERS * 5
// Maximum ciphertext plus JSON escaping and routing metadata for every device.
export const E2E_SEND_MAX_BYTES = E2E_MAX_RECIPIENT_DEVICES * (E2E_CIPHERTEXT_MAX * 6 + 256) + 4096
export const CIPHERTEXT_TYPE_WHISPER = 1

export const encryptedSendSchema = z
  .object({
    conversationId: z.string().uuid(),
    clientId: z.string().uuid(),
    installId: z.string().uuid(),
    attachmentIds: attachmentIdsSchema.optional(),
    replyTo: z.string().uuid().optional(),
    threadRootId: z.string().uuid().optional(),
    envelopes: z
      .array(
        z.object({
          targetUserId: z.string().uuid(),
          targetDeviceId: z.number().int().min(1).max(5),
          ciphertext: z.string().min(1).max(E2E_CIPHERTEXT_MAX),
        }),
      )
      .min(1)
      .max(E2E_MAX_RECIPIENT_DEVICES),
  })
  .refine((send) => !send.replyTo || Boolean(send.threadRootId), {
    message: 'Replies require a thread root',
  })

export type EncryptedSend = z.infer<typeof encryptedSendSchema>
