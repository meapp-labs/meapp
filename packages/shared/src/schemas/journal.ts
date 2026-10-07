import { z } from 'zod'
export const journalEntrySchema = z.strictObject({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(10000),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
})
export const journalSchema = z.strictObject({
  version: z.literal(1),
  accountId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  entries: z.array(journalEntrySchema).max(200),
})
export type Journal = z.infer<typeof journalSchema>
