import { randomUUID } from 'node:crypto'
import { jwt } from '@elysiajs/jwt'
import { Elysia, t } from 'elysia'
import { canAccessRoom } from '../lib/authz.ts'
import { env } from '../lib/config.ts'
import { authPlugin } from '../plugins/auth.ts'
import { redisPlugin } from '../plugins/redis.ts'

export const inMemoryTickets = new Map<string, { userId: string; roomId: string; exp: number }>()
const cleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, val] of inMemoryTickets) {
    if (val.exp < now) inMemoryTickets.delete(key)
  }
}, 30000)
cleanupInterval.unref?.()

export const wsTicketRoutes = new Elysia({ prefix: '/ws' })
  .use(authPlugin)
  .use(redisPlugin)
  .use(
    jwt({
      name: 'ticketJwt',
      schema: t.Object({
        sub: t.String(),
        roomId: t.String(),
        jti: t.String(),
        type: t.String(),
      }),
      secret: env.WS_TICKET_SECRET,
      exp: '60s',
    }),
  )
  .post(
    '/ticket',
    async ({ user, body, ticketJwt, redis, set }) => {
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }
      const { roomId } = body

      const can = await canAccessRoom(user.id, roomId)
      if (!can) {
        set.status = 403
        return { error: 'Forbidden' }
      }

      // Retry on jti collision
      for (let attempt = 0; attempt < 3; attempt++) {
        const jti = randomUUID()
        const ticket = await ticketJwt.sign({ sub: user.id, roomId, jti, type: 'ws_ticket' })

        try {
          const result = (await redis.call(
            'SET',
            `ws_ticket:${jti}`,
            JSON.stringify({ userId: user.id, roomId }),
            'EX',
            70,
            'NX',
          )) as string | null

          if (result !== 'OK') {
            continue
          }
          return { ticket, expiresIn: 60, jti }
        } catch {
          // Redis offline fallback
          inMemoryTickets.set(jti, { userId: user.id, roomId, exp: Date.now() + 70000 })
          return { ticket, expiresIn: 60, jti }
        }
      }

      set.status = 500
      return { error: 'Failed to create ticket after retries' }
    },
    {
      body: t.Object({ roomId: t.String({ format: 'uuid' }) }),
    },
  )
