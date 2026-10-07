import { expect, it } from 'bun:test'
import { inMemoryTickets } from '../routes/wsTicket.ts'
import { authenticateTicket } from './authenticateTicket.ts'

it('consumes fallback tickets once, rejects expiry, and validates signed purpose and stored identity', async () => {
  const jti = crypto.randomUUID()
  const payload = { sub: 'user', roomId: 'room', jti, type: 'ws_ticket' }
  const offline = {
    getdel: async (): Promise<string | null> => {
      throw new Error('offline')
    },
  }
  const verify = async () => payload
  inMemoryTickets.set(jti, { userId: 'user', roomId: 'room', exp: Date.now() + 1000 })
  try {
    expect(await authenticateTicket('ticket', 'room', verify, offline, () => true)).toBe('user')
    await expect(authenticateTicket('ticket', 'room', verify, offline, () => true)).rejects.toThrow(
      'expired or already used',
    )
    inMemoryTickets.set(jti, { userId: 'user', roomId: 'room', exp: Date.now() - 1 })
    await expect(authenticateTicket('ticket', 'room', verify, offline, () => true)).rejects.toThrow(
      'expired or already used',
    )
    expect(inMemoryTickets.has(jti)).toBe(false)
    await expect(
      authenticateTicket(
        'ticket',
        'room',
        async () => ({ ...payload, type: 'session' }),
        offline,
        () => true,
      ),
    ).rejects.toThrow('Invalid ticket payload')
    await expect(
      authenticateTicket(
        'ticket',
        'room',
        verify,
        { getdel: async () => JSON.stringify({ userId: 'other', roomId: 'room' }) },
        () => true,
      ),
    ).rejects.toThrow('identity mismatch')
  } finally {
    inMemoryTickets.delete(jti)
  }
})
