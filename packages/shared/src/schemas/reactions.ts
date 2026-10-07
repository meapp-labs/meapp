import { z } from 'zod'

export const REACTION_EMOJI = [
  '❤️',
  '👍',
  '😂',
  '😮',
  '😢',
  '🔥',
  '🎉',
  '🙏',
  '👏',
  '💯',
  '🤔',
  '👀',
  '😍',
  '🥳',
  '😎',
  '✅',
  '💪',
  '✨',
  '🙌',
  '🤝',
  '🫶',
  '😅',
  '😭',
  '💔',
] as const
export const reactionOperationSchema = z
  .object({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    installId: z.string().uuid(),
    operationId: z.string().uuid(),
    predecessor: z.number().int().nonnegative(),
    emoji: z.enum(REACTION_EMOJI).nullable(),
  })
  .strict()
export const reactionSyncSchema = z.object({
  conversationId: z.string().uuid(),
  installId: z.string().uuid(),
  after: z.coerce.number().int().nonnegative().default(0),
  audience: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional(),
})
export type ReactionOperation = z.infer<typeof reactionOperationSchema>
export type ReactionEntry = {
  messageId: string
  userId: string
  username: string
  emoji: (typeof REACTION_EMOJI)[number] | null
  revision: number
}
export type ReactionSync = {
  entries: ReactionEntry[]
  cursor: number
  hasMore: boolean
  audienceVersion: string
}
