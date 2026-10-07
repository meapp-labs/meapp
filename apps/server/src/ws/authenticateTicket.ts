import type Redis from 'ioredis'
import { roomInteractionAllowed } from '../lib/authz.ts'
import { inMemoryTickets } from '../routes/wsTicket.ts'

export class TicketAuthError extends Error {
  constructor(
    message: string,
    readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' = 'UNAUTHENTICATED',
  ) {
    super(message)
  }
}

export async function authenticateTicket(
  ticket: string,
  roomId: string,
  verify: (ticket: string) => Promise<unknown>,
  redis: Pick<Redis, 'getdel'>,
  authorize: (userId: string, roomId: string) => boolean = roomInteractionAllowed,
): Promise<string> {
  const payload = (await verify(ticket)) as
    | { sub?: string; roomId?: string; jti?: string; type?: string }
    | false
  if (!payload || !payload.sub || !payload.jti || !payload.roomId || payload.type !== 'ws_ticket')
    throw new TicketAuthError('Invalid ticket payload')
  if (payload.roomId !== roomId) throw new TicketAuthError('Ticket room mismatch', 'FORBIDDEN')
  let stored: string | null = null
  try {
    stored = await redis.getdel(`ws_ticket:${payload.jti}`)
  } catch {
    // Redis is optional; tickets issued in degraded mode live only in this process.
  }
  if (!stored) {
    const fallback = inMemoryTickets.get(payload.jti)
    inMemoryTickets.delete(payload.jti)
    if (fallback && fallback.exp > Date.now())
      stored = JSON.stringify({ userId: fallback.userId, roomId: fallback.roomId })
  }
  if (!stored)
    throw new TicketAuthError('Ticket expired or already used; reconnect for a new ticket')
  const record = JSON.parse(stored) as { userId?: string; roomId?: string }
  if (record.userId !== payload.sub || record.roomId !== roomId)
    throw new TicketAuthError('Ticket identity mismatch')
  if (!authorize(payload.sub, roomId))
    throw new TicketAuthError('Not a member of this room', 'FORBIDDEN')
  return payload.sub
}
