import { jwt } from '@elysiajs/jwt'
import { getDbInstance } from '@meapp/db'
import { MESSAGE_MAX_LENGTH, messageWsIncomingSchema } from '@meapp/shared'
import { Elysia, t } from 'elysia'
import { roomInteractionAllowed } from '../lib/authz.ts'
import { clientIpOf } from '../lib/clientIp.ts'
import { WS_CONFIG, env, isE2EEnabled } from '../lib/config.ts'
import { ApiError, ErrorCode } from '../lib/errors.ts'
import { logger } from '../lib/logger.ts'
import { sendMessage } from '../lib/services/sendMessage.ts'
import { authPlugin } from '../plugins/auth.ts'
import { redis, redisPlugin } from '../plugins/redis.ts'
import { TicketAuthError, authenticateTicket } from './authenticateTicket.ts'
import {
  USER_CONNECTION_REFRESH_MS,
  WsConnectionManager,
  type WsSessionState,
} from './connectionManager.ts'
import { RedisPubsub, roomChannel, roomTypingChannel } from './redisPubsub.ts'

const connectionManager = new WsConnectionManager(redis)
const wsStates = new WeakMap<object, WsSessionState>()

type ActiveSocketEntry = {
  ws: {
    raw: object
    data: { query: { roomId: string } }
    unsubscribe: (topic: string) => void
    send: (data: string) => void
    close: (code?: number, reason?: string) => void
  }
  state: WsSessionState
}
const activeSockets = new Set<ActiveSocketEntry>()

export const revokeUserRoomAccess = async (userId: string, roomId: string): Promise<void> => {
  for (const entry of Array.from(activeSockets)) {
    if (!entry.state.closed && entry.state.authenticatedUserId === userId) {
      if (entry.state.subscribedRooms.has(roomId)) {
        entry.state.subscribedRooms.delete(roomId)
        entry.ws.unsubscribe(`room:${roomId}`)
        entry.ws.send(
          JSON.stringify({
            type: 'unsubscribed',
            payload: { roomId, reason: 'MEMBERSHIP_REVOKED' },
          }),
        )
      }
      if (entry.ws.data.query?.roomId === roomId) {
        entry.ws.close(4403, 'Room membership revoked')
      }
      await connectionManager.unsubscribeRoom(userId, roomId)
    }
  }
}

export const broadcastRevokeUserRoomAccess = async (
  userId: string,
  roomId: string,
): Promise<void> => {
  await revokeUserRoomAccess(userId, roomId)
  const message = JSON.stringify({ type: 'revoke_access', payload: { userId, roomId } })
  await pubsub.publish(`meapp:room-revoke:${roomId}`, message)
}

const pubsub = new RedisPubsub(redis)
let getLocalServer:
  | (() => { publish: (topic: string, data: string) => void } | undefined)
  | undefined

export const startPubsub = (
  getServer: () => { publish: (topic: string, data: string) => void } | undefined,
) => {
  getLocalServer = getServer
  return pubsub.start((channel, message) => {
    if (channel.startsWith('meapp:room-revoke:')) {
      try {
        const parsed = JSON.parse(message) as {
          type?: string
          payload?: { userId: string; roomId: string }
        }
        if (parsed?.type === 'revoke_access' && parsed.payload) {
          void revokeUserRoomAccess(parsed.payload.userId, parsed.payload.roomId)
        }
      } catch {}
      return
    }
    const localTopic = channel.startsWith('meapp:room-typing:')
      ? `room:${channel.slice('meapp:room-typing:'.length)}`
      : `room:${channel.slice('meapp:room:'.length)}`
    getServer()?.publish(localTopic, message)
  })
}

export const broadcastToRoom = async (roomId: string, message: string): Promise<void> => {
  if (!(await pubsub.publish(roomChannel(roomId), message))) {
    getLocalServer?.()?.publish(`room:${roomId}`, message)
  }
}

const broadcastTypingToRoom = async (
  ws: { publish: (topic: string, message: string) => unknown },
  roomId: string,
  message: string,
): Promise<void> => {
  if (!(await pubsub.publish(roomTypingChannel(roomId), message))) {
    ws.publish(`room:${roomId}`, message)
  }
}

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
      secret: env.WS_TICKET_SECRET,
      exp: '60s',
    }),
  )
  .ws('/ws', {
    query: t.Object({
      roomId: t.String({ format: 'uuid' }),
    }),
    body: messageWsIncomingSchema,
    async open(ws) {
      const { request, server } = ws.data
      const ip = clientIpOf(request, server)

      const state: WsSessionState = {
        ip,
        connectionId: Bun.randomUUIDv7(),
        subscribedRooms: new Set<string>(),
      }
      wsStates.set(ws.raw, state)
      activeSockets.add({ ws, state })

      // Web and native clients both authenticate with a single-use ticket.
      const allowedUnauth = await connectionManager.canAcceptUnauth(ip)
      if (!allowedUnauth) {
        ws.close(1013, 'Too many unauthenticated connections')
        return
      }
      if (state.closed) {
        await connectionManager.releaseUnauth(ip, allowedUnauth)
        return
      }
      state.unauthCounted = true
      state.unauthSource = allowedUnauth

      state.authTimeoutTimer = setTimeout(() => {
        if (!state.authenticatedUserId && !state.closed) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'UNAUTHENTICATED', message: 'AUTH required within timeout' },
            }),
          )
          ws.close(4401, 'Auth timeout')
        }
      }, WS_CONFIG.UNAUTH_TIMEOUT_MS)
    },

    async message(ws, msg) {
      const state = wsStates.get(ws.raw)
      if (!state || state.closed) return
      const roomId = ws.data.query.roomId

      // Handle AUTH ticket
      if (msg.type === 'auth') {
        // A socket can authenticate only once.
        if (state?.authenticatedUserId) return

        const ticket = msg.payload.ticket
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
          const userId = await authenticateTicket(
            ticket,
            roomId,
            (value) => ticketJwt.verify(value),
            redisClient,
          )

          const allowed = await connectionManager.canUserConnect(userId, state.connectionId)
          if (state.closed) {
            if (allowed) {
              await connectionManager.releaseUserConnection(userId, state.connectionId)
            }
            return
          }
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

          state.authenticatedUserId = userId
          const subscribed = await connectionManager.canSubscribeRoom(userId, roomId)
          if (state.closed) {
            if (subscribed) await connectionManager.unsubscribeRoom(userId, roomId)
            return
          }
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

          if (state.authTimeoutTimer) {
            clearTimeout(state.authTimeoutTimer)
            state.authTimeoutTimer = undefined
          }
          state.subscribedRooms.add(roomId)

          // Membership or blocking may have changed while awaiting subscription limits.
          if (!roomInteractionAllowed(userId, roomId)) {
            state.subscribedRooms.delete(roomId)
            await connectionManager.unsubscribeRoom(userId, roomId)
            ws.close(4403, 'Room membership revoked')
            return
          }

          ws.subscribe(`room:${roomId}`)
          if (state.unauthCounted) {
            state.unauthCounted = false
            if (state.unauthSource)
              await connectionManager.releaseUnauth(state.ip, state.unauthSource)
          }

          state.leaseTimer = setInterval(() => {
            void connectionManager.canUserConnect(userId, state.connectionId).then((renewed) => {
              if (!renewed && !state.closed) ws.close(4429, 'Connection lease expired')
            })
          }, USER_CONNECTION_REFRESH_MS)

          ws.send(JSON.stringify({ type: 'authenticated', payload: { userId } }))
        } catch (err) {
          logger.warn('ws.authentication_failed', { connectionId: state.connectionId, roomId, err })
          const code = err instanceof TicketAuthError ? err.code : 'UNAUTHENTICATED'
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: {
                code,
                message: err instanceof TicketAuthError ? err.message : 'Invalid ticket signature',
              },
            }),
          )
          ws.close(code === 'FORBIDDEN' ? 4403 : 4401, 'Ticket rejected')
        }
        return
      }

      // Ensure user is authenticated
      const userId = state.authenticatedUserId
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
        const can = roomInteractionAllowed(userId, targetRoom)
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

        if (state.closed || !roomInteractionAllowed(userId, targetRoom)) {
          await connectionManager.unsubscribeRoom(userId, targetRoom)
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { code: 'FORBIDDEN', message: 'Room membership revoked' },
            }),
          )
          return
        }
        state.subscribedRooms.add(targetRoom)
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

        const can = roomInteractionAllowed(userId, targetRoom)
        if (!can) return

        const typingMsg = JSON.stringify({
          type: 'typing',
          payload: { roomId: targetRoom, userId },
        })
        await broadcastTypingToRoom(ws, targetRoom, typingMsg)
        return
      }

      // Handle message events
      if (msg.type === 'message') {
        if (isE2EEnabled()) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: {
                code: 'VALIDATION_ERROR',
                message: 'Encrypted messages use the authenticated send endpoint',
              },
            }),
          )
          return
        }
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

        // Size check mirrors the shared schema.
        if (payload.text.length > MESSAGE_MAX_LENGTH) {
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: {
                code: 'TOO_LARGE',
                message: `Message exceeds ${MESSAGE_MAX_LENGTH} characters`,
              },
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

        const can = roomInteractionAllowed(userId, payload.roomId)
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
          const senderRow = getDbInstance()
            .sqlite.query('SELECT username FROM users WHERE id=?')
            .get(userId) as { username: string | null } | null
          const result = await sendMessage(
            { conversationId: payload.roomId, clientId: payload.clientId, text: payload.text },
            { id: userId, username: senderRow?.username ?? userId },
            getDbInstance(),
            broadcastToRoom,
          )

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
        } catch (e) {
          if (e instanceof ApiError && e.code === ErrorCode.DUPLICATE_ITEM) {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { code: 'CONFLICT', message: e.message },
              }),
            )
            return
          }
          logger.error('ws.message_failed', {
            connectionId: state.connectionId,
            userId,
            roomId: payload.roomId,
            clientId: payload.clientId,
            err: e,
          })
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
      const state = wsStates.get(ws.raw)
      if (!state) return
      state.closed = true

      if (state.authTimeoutTimer) {
        clearTimeout(state.authTimeoutTimer)
      }
      if (state.leaseTimer) clearInterval(state.leaseTimer)

      if (state.unauthCounted) {
        state.unauthCounted = false
        if (state.unauthSource) await connectionManager.releaseUnauth(state.ip, state.unauthSource)
      }

      if (state.authenticatedUserId) {
        const userId = state.authenticatedUserId
        await connectionManager.releaseUserConnection(userId, state.connectionId)

        for (const rId of state.subscribedRooms) {
          await connectionManager.unsubscribeRoom(userId, rId)
          ws.unsubscribe(`room:${rId}`)
        }
      }

      wsStates.delete(ws.raw)
      for (const entry of activeSockets) {
        if (entry.ws.raw === ws.raw) {
          activeSockets.delete(entry)
          break
        }
      }
    },
  })

export function closeChatSocketsForRestart() {
  for (const entry of activeSockets)
    entry.ws.close(1012, 'Server restarting; reconnect for a new ticket')
}
