import { z } from 'zod'

// Read state is private to the authenticated account. There is no sharing flag.
export const acknowledgeMessagesSchema = z
  .object({
    conversationId: z.string().uuid(),
    installId: z.string().uuid().optional(),
    messageIds: z
      .array(z.string().uuid())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Message IDs must be unique'),
  })
  .strict()
export type AcknowledgeMessages = z.infer<typeof acknowledgeMessagesSchema>
