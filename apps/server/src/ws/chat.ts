import { jwt } from '@elysiajs/jwt'
import { insertMessageWithSequence, sqlite } from '@meapp/db'
import { Elysia, t } from 'elysia'
import { canAccessRoom } from '../lib/authz.ts'
import { WS_CONFIG, env } from '../lib/config.ts'
import { authPlugin } from '../plugins/auth.ts'
import { redis, redisPlugin } from '../plugins/redis.ts'
import { WsConnectionManager, type WsSessionState } from './connectionManager.ts'

const connectionManager = new WsConnectionManager(redis)
const wsStates = new WeakMap<object, WsSessionState>()

const incomingMessageBody = t.Union([
  t.Object({
    type: t.Literal('message'),
    payload: t.Object({
      roomId: t.String({ format: 'uuid' }),
      text: t.String({ minLength: 1, maxLength: 4000 }),
      clientId: t.String({ format: 'uuid' }),
    }),
  }),
  t.Object({
    type: t.Literal('typing'),
    payload: t.Object({
      roomId: t.String({ format: 'uuid' }),
    }),
  }),
  t.Object({
    type: t.Literal('auth'),
    payload: t.Object({
      ticket: t.Optional(t.String()),
      token: t.Optional(t.String()),
    }),
  }),
  t.Object({
    type: t.Literal('subscribe'),
    payload: t.Object({
      roomId: t.String({ format: 'uuid' }),
    }),
  }),
  t.Object({
    type: t.Literal('unsubscribe'),
    payload: t.Object({
      roomId: t.String({ format: 'uuid' }),
    }),
  }),
])

export const chatWs = new Elysia()
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
      secret: env.WS_TICKET_SECRET || env.JWT_SECRET,
      exp: '60s',
    }),
  )
  .ws('/ws', {
    query: t.Object({
      roomId: t.String({ format: 'uuid' }),
    }),
    body: incomingMessageBody,
    async open(ws) {
      const { user, request, query } = ws.data
      const roomId = query.roomId
      const ip = request.headers.get('x-forwarded-for') || 'unknown'

      const state: WsSessionState = { ip, subscribedRooms: new Set<string>() }
      wsStates.set(ws, state)

      // If user was derived from HttpOnly cookie (Web flow)
      if (user) {
        const can = await canAccessRoom(user.id, roomId)
        if (!can) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'FORBIDDEN', message: 'Not member of room' },
            }),
          )
          ws.close(4403, 'Forbidden')
          return
        }

        const allowed = await connectionManager.canUserConnect(user.id)
        if (!allowed) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'RATE_LIMIT', message: 'Too many connections' },
            }),
          )
          ws.close(4429, 'Too many connections')
          return
        }

        const subscribed = await connectionManager.canSubscribeRoom(user.id, roomId)
        if (!subscribed) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: {
                code: 'RATE_LIMIT',
                message: 'Maximum room subscriptions per user exceeded',
              },
            }),
          )
          ws.close(4429, 'Too many subscriptions')
          return
        }

        state.authenticatedUserId = user.id
        state.subscribedRooms.add(roomId)
        ws.subscribe(`room:${roomId}`)
        ws.send(JSON.stringify({ type: 'authenticated', payload: { userId: user.id } }))
      } else {
        // Native unauthenticated connection
        const allowedUnauth = await connectionManager.canAcceptUnauth(ip)
        if (!allowedUnauth) {
          ws.close(1013, 'Too many unauthenticated connections')
          return
        }

        // Strict timeout window for AUTH message
        state.authTimeoutTimer = setTimeout(async () => {
          if (!state.authenticatedUserId) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'UNAUTHENTICATED', message: 'AUTH required within timeout' },
              }),
            )
            ws.close(4401, 'Auth timeout')
            await connectionManager.releaseUnauth(ip)
          }
        }, WS_CONFIG.UNAUTH_TIMEOUT_MS)
      }
    },

    async message(ws, msg) {
      const state = wsStates.get(ws)
      const roomId = ws.data.query.roomId

      // Handle AUTH ticket
      if (msg.type === 'auth') {
        const ticket = msg.payload.ticket || msg.payload.token
        if (!ticket) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'UNAUTHENTICATED', message: 'Ticket required' },
            }),
          )
          return
        }

        const { redis: redisClient, ticketJwt } = ws.data
        try {
          const payload = (await ticketJwt.verify(ticket)) as unknown as {
            sub?: string
            roomId?: string
            jti?: string
          }
          if (!payload?.sub || !payload?.jti || !payload?.roomId) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'UNAUTHENTICATED', message: 'Invalid ticket payload' },
              }),
            )
            ws.close(4401, 'Invalid ticket')
            return
          }

          const key = `ws_ticket:${payload.jti}`
          const stored = await redisClient.get(key)
          if (!stored) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'UNAUTHENTICATED', message: 'Ticket expired or already used' },
              }),
            )
            ws.close(4401, 'Ticket invalid')
            return
          }

          // Single-use: delete immediately
          await redisClient.del(key)

          const userId = payload.sub
          if (payload.roomId !== roomId) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'FORBIDDEN', message: 'Ticket room mismatch' },
              }),
            )
            ws.close(4403, 'Room mismatch')
            return
          }

          const can = await canAccessRoom(userId, roomId)
          if (!can) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'FORBIDDEN', message: 'Not member of room' },
              }),
            )
            ws.close(4403, 'Forbidden')
            return
          }

          const allowed = await connectionManager.canUserConnect(userId)
          if (!allowed) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'RATE_LIMIT', message: 'Too many connections for user' },
              }),
            )
            ws.close(4429, 'Too many connections')
            return
          }

          const subscribed = await connectionManager.canSubscribeRoom(userId, roomId)
          if (!subscribed) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: {
                  code: 'RATE_LIMIT',
                  message: 'Maximum room subscriptions per user exceeded',
                },
              }),
            )
            ws.close(4429, 'Too many subscriptions')
            return
          }

          if (state) {
            state.authenticatedUserId = userId
            if (state.authTimeoutTimer) {
              clearTimeout(state.authTimeoutTimer)
              state.authTimeoutTimer = undefined
            }
            state.subscribedRooms.add(roomId)
          }

          ws.subscribe(`room:${roomId}`)
          await connectionManager.releaseUnauth(state?.ip || 'unknown')

          ws.send(JSON.stringify({ type: 'authenticated', payload: { userId } }))
        } catch {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'UNAUTHENTICATED', message: 'Invalid ticket signature' },
            }),
          )
          ws.close(4401, 'Invalid ticket')
        }
        return
      }

      // Ensure user is authenticated
      const userId = state?.authenticatedUserId || ws.data.user?.id
      if (!userId) {
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { code: 'UNAUTHENTICATED', message: 'Not authenticated' },
          }),
        )
        return
      }

      // Handle subscribe event
      if (msg.type === 'subscribe') {
        const targetRoom = msg.payload.roomId
        const can = await canAccessRoom(userId, targetRoom)
        if (!can) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'FORBIDDEN', message: 'Not member of room' },
            }),
          )
          return
        }

        const subscribed = await connectionManager.canSubscribeRoom(userId, targetRoom)
        if (!subscribed) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: {
                code: 'RATE_LIMIT',
                message: 'Maximum room subscriptions per user exceeded',
              },
            }),
          )
          return
        }

        state?.subscribedRooms.add(targetRoom)
        ws.subscribe(`room:${targetRoom}`)
        ws.send(
          JSON.stringify({
            type: 'subscribed',
            payload: { roomId: targetRoom },
          }),
        )
        return
      }

      // Handle unsubscribe event
      if (msg.type === 'unsubscribe') {
        const targetRoom = msg.payload.roomId
        await connectionManager.unsubscribeRoom(userId, targetRoom)
        state?.subscribedRooms.delete(targetRoom)
        ws.unsubscribe(`room:${targetRoom}`)
        ws.send(
          JSON.stringify({
            type: 'unsubscribed',
            payload: { roomId: targetRoom },
          }),
        )
        return
      }

      // Handle typing events
      if (msg.type === 'typing') {
        const targetRoom = msg.payload.roomId
        if (targetRoom !== roomId && !state?.subscribedRooms.has(targetRoom)) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'FORBIDDEN', message: 'Room mismatch' },
            }),
          )
          return
        }

        const allowed = await connectionManager.checkTypingRateLimit(userId)
        if (!allowed) return

        const can = await canAccessRoom(userId, targetRoom)
        if (!can) return

        ws.publish(
          `room:${targetRoom}`,
          JSON.stringify({ type: 'typing', payload: { roomId: targetRoom, userId } }),
        )
        return
      }

      // Handle message events
      if (msg.type === 'message') {
        const payload = msg.payload
        if (payload.roomId !== roomId && !state?.subscribedRooms.has(payload.roomId)) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'FORBIDDEN', message: 'Room mismatch' },
            }),
          )
          return
        }

        // Size check (max 4KB)
        if (payload.text.length > 4000) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'TOO_LARGE', message: 'Message text exceeds 4000 characters' },
            }),
          )
          return
        }

        const allowed = await connectionManager.checkMessageRateLimit(userId)
        if (!allowed) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'RATE_LIMIT', message: 'Too many messages, slow down' },
            }),
          )
          return
        }

        const can = await canAccessRoom(userId, payload.roomId)
        if (!can) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'FORBIDDEN', message: 'Not a member of this room' },
            }),
          )
          return
        }

        // Atomic sequence insertion with BEGIN IMMEDIATE and retry
        try {
          const result = await insertMessageWithSequence(sqlite, {
            roomId: payload.roomId,
            userId,
            clientId: payload.clientId,
            text: payload.text,
          })

          if (!result) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'DB_ERROR', message: 'Failed to commit message after retries' },
              }),
            )
            return
          }

          // Acknowledge sender
          ws.send(
            JSON.stringify({
              type: 'ack',
              payload: {
                clientId: payload.clientId,
                id: result.id,
                sequence: result.sequence,
              },
            }),
          )

          // Broadcast to room
          const messageBroadcast = {
            id: result.id,
            clientId: payload.clientId,
            roomId: payload.roomId,
            userId,
            sequence: result.sequence,
            text: payload.text,
            createdAt: new Date().toISOString(),
          }

          ws.publish(
            `room:${payload.roomId}`,
            JSON.stringify({ type: 'message', payload: messageBroadcast }),
          )
        } catch (e) {
          console.error('[chatWs] Error writing message:', e)
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'DB_ERROR', message: 'Failed to store message' },
            }),
          )
        }
      }
    },

    async close(ws) {
      const state = wsStates.get(ws)
      const roomId = ws.data.query.roomId

      if (state?.authTimeoutTimer) {
        clearTimeout(state.authTimeoutTimer)
      }

      if (!state?.authenticatedUserId) {
        await connectionManager.releaseUnauth(state?.ip || 'unknown')
        ws.unsubscribe(`room:${roomId}`)
      } else {
        const userId = state.authenticatedUserId
        await connectionManager.releaseUserConnection(userId)

        if (state) {
          for (const rId of Array.from(state.subscribedRooms)) {
            await connectionManager.unsubscribeRoom(userId, rId)
            ws.unsubscribe(`room:${rId}`)
          }
        }
      }

      wsStates.delete(ws)
    },
  })
