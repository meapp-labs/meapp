import { eq, max } from 'drizzle-orm'
import { db } from './client.ts'
import * as schema from './schema.ts'

export const nextSequence = async (roomId: string): Promise<number> => {
  return await db.transaction(async (tx) => {
    const result = await tx
      .select({ maxSeq: max(schema.messages.sequence) })
      .from(schema.messages)
      .where(eq(schema.messages.roomId, roomId))
      .get()
    const next = (result?.maxSeq || 0) + 1
    return next
  })
}
