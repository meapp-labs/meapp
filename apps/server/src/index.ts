import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { Elysia } from 'elysia'
import { authPlugin } from './plugins/auth.ts'
import { rateLimitPlugin } from './plugins/rateLimit.ts'
import { redisPlugin } from './plugins/redis.ts'
import { wsTicketRoutes } from './routes/wsTicket.ts'
import { chatWs } from './ws/chat.ts'

export const app = new Elysia()
  .use(cors())
  .use(swagger())
  .use(redisPlugin)
  .use(authPlugin)
  .use(rateLimitPlugin)
  .get('/health', () => ({
    status: 'ok',
    podman: true,
    bun: '1.4.2',
    timestamp: new Date().toISOString(),
  }))
  .use(wsTicketRoutes)
  .use(chatWs)

export type App = typeof app

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '127.0.0.1'

if (import.meta.main) {
  app.listen({ port, hostname: host }, () => {
    console.log(`🚀 Elysia server running at http://${host}:${port}`)
  })
}
