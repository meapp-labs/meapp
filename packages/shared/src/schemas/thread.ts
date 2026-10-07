import { z } from 'zod'

export const threadSummarySchema = z.object({
  rootId: z.string().uuid(),
  replyCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  participantCount: z.number().int().nonnegative(),
  lastReplySequence: z.number().int().nonnegative(),
  lastReplyAt: z.string(),
  firstUnreadSequence: z.number().int().nonnegative().nullable(),
})
export type ThreadSummary = z.infer<typeof threadSummarySchema>
