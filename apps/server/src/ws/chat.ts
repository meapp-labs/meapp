import { jwt } from '@elysiajs/jwt'
import { insertMessageWithSequence, sqlite } from '@meapp/db'
import { Elysia, t } from 'elysia'
import { canAccessRoom } from '../lib/authz.ts'
import { authPlugin } from '../plugins/auth.ts'
import { redisPlugin } from '../plugins/redis.ts'

// ─────────────────────────────────────────────────────────────
// Connection & Rate Limit State (V8 Phase 4 & Phase 8 - Fix #3, #4, #5)
// ─────────────────────────────────────────────────────────────

let unauthConnections = 0
const MAX_UNAUTH_GLOBAL = 100
const UNAUTH_TIMEOUT_MS = 2000 // 2 seconds to authenticate via ticket
const perIpUnauth = new Map<string, number>()

const wsConnectionsPerUser = new Map<string, number>()
const wsMessagesPerUser = new Map<string, { count: number; reset: number }>()
const wsTypingPerUser = new Map<string, { count: number; reset: number }>()
// V8 Phase 8: Subscriptions per user: 10 rooms max
const wsRoomRefCountsPerUser = new Map<string, Map<string, number>>()

// Periodic cleanup every 5 minutes to prevent memory leaks (Fix #5)
const wsCleanupInterval = setInterval(
  () => {
    const now = Date.now()

    for (const [userId, data] of wsMessagesPerUser) {
      if (data.reset < now - 60000) {
        wsMessagesPerUser.delete(userId)
      }
    }

    for (const [userId, data] of wsTypingPerUser) {
      if (data.reset < now - 60000) {
        wsTypingPerUser.delete(userId)
      }
    }

    for (const [userId, count] of wsConnectionsPerUser) {
      if (count <= 0) {
        wsConnectionsPerUser.delete(userId)
      }
    }

    for (const [ip, count] of perIpUnauth) {
      if (count <= 0) {
        perIpUnauth.delete(ip)
      }
    }

    for (const [userId, rooms] of wsRoomRefCountsPerUser) {
      if (rooms.size === 0) {
        wsRoomRefCountsPerUser.delete(userId)
      }
    }
  },
  5 * 60 * 1000,
)

wsCleanupInterval.unref?.()

type WsState = {
  authenticatedUserId?: string | undefined
  ip: string
  authTimeoutTimer?: ReturnType<typeof setTimeout> | undefined
  subscribedRooms: Set<string>
}

type WsSubscriber = {
  subscribe: (topic: string) => void
  unsubscribe: (topic: string) => void
}

const addRoomSubscription = (
  userId: string,
  roomId: string,
  ws: WsSubscriber,
  state: WsState,
): boolean => {
  let userRooms = wsRoomRefCountsPerUser.get(userId)
  if (!userRooms) {
    userRooms = new Map<string, number>()
    wsRoomRefCountsPerUser.set(userId, userRooms)
  }

  const currentCount = userRooms.get(roomId) || 0
  if (currentCount === 0 && userRooms.size >= 10) {
    return false
  }

  userRooms.set(roomId, currentCount + 1)
  state.subscribedRooms.add(roomId)
  ws.subscribe(`room:${roomId}`)
  return true
}

const removeRoomSubscription = (
  userId: string,
  roomId: string,
  ws: WsSubscriber,
  state: WsState,
): void => {
  ws.unsubscribe(`room:${roomId}`)
  state.subscribedRooms.delete(roomId)

  const userRooms = wsRoomRefCountsPerUser.get(userId)
  if (userRooms) {
    const count = userRooms.get(roomId) || 0
    if (count <= 1) {
      userRooms.delete(roomId)
    } else {
      userRooms.set(roomId, count - 1)
    }
    if (userRooms.size === 0) {
      wsRoomRefCountsPerUser.delete(userId)
    }
  }
}

const wsStates = new WeakMap<object, WsState>()

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
      secret: process.env.WS_TICKET_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me',
      exp: '60s',
    }),
  )
  .ws('/ws', {
    query: t.Object({
      roomId: t.String({ format: 'uuid' }),
    }),
    body: incomingMessageBody,
    open(ws) {
      const { user, request, query } = ws.data
      const roomId = query.roomId
      const ip = request.headers.get('x-forwarded-for') || 'unknown'

      const state: WsState = { ip, subscribedRooms: new Set<string>() }
      wsStates.set(ws, state)

      // If user was derived from HttpOnly cookie (Web flow)
      if (user) {
        canAccessRoom(user.id, roomId).then((can) => {
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

          const conns = wsConnectionsPerUser.get(user.id) || 0
          if (conns >= 3) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'RATE_LIMIT', message: 'Too many connections' },
              }),
            )
            ws.close(4429, 'Too many connections')
            return
          }

          // V8 Phase 8: Max 10 room subscriptions per user
          const subscribed = addRoomSubscription(user.id, roomId, ws, state)
          if (!subscribed) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: {
                  code: 'RATE_LIMIT',
                  message: 'Maximum 10 room subscriptions per user exceeded',
                },
              }),
            )
            ws.close(4429, 'Too many subscriptions')
            return
          }

          wsConnectionsPerUser.set(user.id, conns + 1)
          state.authenticatedUserId = user.id
          ws.send(JSON.stringify({ type: 'authenticated', payload: { userId: user.id } }))
        })
      } else {
        // Native unauthenticated connection - enforce V8 DoS protection (Fix #3)
        if (unauthConnections >= MAX_UNAUTH_GLOBAL) {
          ws.close(1013, 'Too many unauthenticated connections')
          return
        }

        const ipCount = perIpUnauth.get(ip) || 0
        if (ipCount >= 10) {
          ws.close(1013, 'Too many unauthenticated connections per IP')
          return
        }

        unauthConnections++
        perIpUnauth.set(ip, ipCount + 1)

        // Strict 2s window for AUTH message
        state.authTimeoutTimer = setTimeout(() => {
          if (!state.authenticatedUserId) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'UNAUTHENTICATED', message: 'AUTH required within 2s' },
              }),
            )
            ws.close(4401, 'Auth timeout')
            unauthConnections = Math.max(0, unauthConnections - 1)
            perIpUnauth.set(ip, Math.max(0, (perIpUnauth.get(ip) || 1) - 1))
          }
        }, UNAUTH_TIMEOUT_MS)
      }
    },

    async message(ws, msg) {
      const state = wsStates.get(ws)
      const roomId = ws.data.query.roomId

      // Handle AUTH ticket (V8 Fix #2)
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

        const { redis, ticketJwt } = ws.data
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
          const stored = await redis.get(key)
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
          await redis.del(key)

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

          // Rate limit: max 3 connections per user
          const conns = wsConnectionsPerUser.get(userId) || 0
          if (conns >= 3) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'RATE_LIMIT', message: 'Too many connections for user' },
              }),
            )
            ws.close(4429, 'Too many connections')
            return
          }

          if (state) {
            state.authenticatedUserId = userId
            if (state.authTimeoutTimer) {
              clearTimeout(state.authTimeoutTimer)
              state.authTimeoutTimer = undefined
            }

            // V8 Phase 8: Max 10 room subscriptions per user
            const subscribed = addRoomSubscription(userId, roomId, ws, state)
            if (!subscribed) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  payload: {
                    code: 'RATE_LIMIT',
                    message: 'Maximum 10 room subscriptions per user exceeded',
                  },
                }),
              )
              ws.close(4429, 'Too many subscriptions')
              return
            }
          }

          wsConnectionsPerUser.set(userId, conns + 1)

          unauthConnections = Math.max(0, unauthConnections - 1)
          const ip = state?.ip || 'unknown'
          perIpUnauth.set(ip, Math.max(0, (perIpUnauth.get(ip) || 1) - 1))

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

      // V8 Phase 8: Handle subscribe event
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

        if (state) {
          const subscribed = addRoomSubscription(userId, targetRoom, ws, state)
          if (!subscribed) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: {
                  code: 'RATE_LIMIT',
                  message: 'Maximum 10 room subscriptions per user exceeded',
                },
              }),
            )
            return
          }
        }

        ws.send(
          JSON.stringify({
            type: 'subscribed',
            payload: { roomId: targetRoom },
          }),
        )
        return
      }

      // V8 Phase 8: Handle unsubscribe event
      if (msg.type === 'unsubscribe') {
        const targetRoom = msg.payload.roomId
        if (state) {
          removeRoomSubscription(userId, targetRoom, ws, state)
        } else {
          ws.unsubscribe(`room:${targetRoom}`)
        }

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

        // Typing rate limit: 5 per 10s
        const now = Date.now()
        const typingLimit = wsTypingPerUser.get(userId)
        if (!typingLimit || typingLimit.reset < now) {
          wsTypingPerUser.set(userId, { count: 1, reset: now + 10000 })
        } else {
          if (typingLimit.count >= 5) return
          typingLimit.count++
        }

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

        // Message rate limit: 10 per 10s
        const now = Date.now()
        const msgLimit = wsMessagesPerUser.get(userId)
        if (!msgLimit || msgLimit.reset < now) {
          wsMessagesPerUser.set(userId, { count: 1, reset: now + 10000 })
        } else {
          if (msgLimit.count >= 10) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'RATE_LIMIT', message: 'Too many messages, slow down' },
              }),
            )
            return
          }
          msgLimit.count++
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

        // Atomic sequence insertion with BEGIN IMMEDIATE and retry (Fix #1, #6)
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

    close(ws) {
      const state = wsStates.get(ws)
      const roomId = ws.data.query.roomId

      if (state?.authTimeoutTimer) {
        clearTimeout(state.authTimeoutTimer)
      }

      if (!state?.authenticatedUserId) {
        unauthConnections = Math.max(0, unauthConnections - 1)
        const ip = state?.ip || 'unknown'
        perIpUnauth.set(ip, Math.max(0, (perIpUnauth.get(ip) || 1) - 1))
        ws.unsubscribe(`room:${roomId}`)
      } else {
        const userId = state.authenticatedUserId
        const conns = wsConnectionsPerUser.get(userId) || 1
        wsConnectionsPerUser.set(userId, Math.max(0, conns - 1))

        if (state) {
          for (const rId of Array.from(state.subscribedRooms)) {
            removeRoomSubscription(userId, rId, ws, state)
          }
        }
      }

      wsStates.delete(ws)
    },
  })
