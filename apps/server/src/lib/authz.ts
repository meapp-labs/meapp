import { and, eq, getDbInstance, schema } from '@meapp/db'

import { createForbiddenError } from './errors.ts'

export function contactBlocked(first: string, second: string): boolean {
  return Boolean(
    getDbInstance()
      .sqlite.query(`SELECT 1 FROM ignored_users
    WHERE (user_id=? AND ignored_user_id=?) OR (user_id=? AND ignored_user_id=?)`)
      .get(first, second, second, first),
  )
}

/** History remains readable; interaction is denied in blocked DMs, not shared groups. */
export function roomInteractionAllowed(userId: string, roomId: string): boolean {
  const sqlite = getDbInstance().sqlite
  const room = sqlite
    .query(`SELECT r.type FROM rooms r JOIN room_members m ON m.room_id=r.id
    WHERE r.id=? AND m.user_id=?`)
    .get(roomId, userId) as { type: string } | null
  if (!room) return false
  if (room.type !== 'dm') return true
  const others = sqlite
    .query('SELECT user_id FROM room_members WHERE room_id=? AND user_id<>?')
    .all(roomId, userId) as { user_id: string }[]
  return others.every((other) => !contactBlocked(userId, other.user_id))
}

export function requireRoomInteraction(userId: string, roomId: string): void {
  if (!roomInteractionAllowed(userId, roomId))
    throw createForbiddenError('Conversation unavailable')
}

export const canAccessRoom = async (userId: string, roomId: string): Promise<boolean> => {
  const member = await getDbInstance()
    .db.select()
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
