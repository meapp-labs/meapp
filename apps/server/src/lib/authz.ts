import { and, db, eq, schema } from '@meapp/db'

import { createForbiddenError } from './errors.ts'

export const canAccessRoom = async (userId: string, roomId: string): Promise<boolean> => {
  const member = await db
    .select()
    .from(schema.roomMembers)
    .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId)))
    .get()
  return Boolean(member)
}

export const requireRoomAccess = async (userId: string, roomId: string): Promise<void> => {
  const can = await canAccessRoom(userId, roomId)
  if (!can) {
    throw createForbiddenError('You are not a participant in this room')
  }
}
