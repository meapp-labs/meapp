import type Redis from 'ioredis'
import { WS_CONFIG } from '../lib/config.ts'

export type WsSessionState = {
  authenticatedUserId?: string | undefined
  ip: string
  connectionId: string
  closed?: boolean
  unauthCounted?: boolean
  authTimeoutTimer?: ReturnType<typeof setTimeout> | undefined
  leaseTimer?: ReturnType<typeof setInterval> | undefined
  subscribedRooms: Set<string>
}

// Per-socket leases expire promptly if a process exits without close handlers.
export const USER_CONNECTION_LEASE_MS = 15000
export const USER_CONNECTION_REFRESH_MS = 5000

const CONNECT_USER_LUA = `
local now = tonumber(ARGV[1])
local expires = now + tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZSCORE', KEYS[1], ARGV[4]) then
  redis.call('ZADD', KEYS[1], expires, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
  return 1
end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], expires, ARGV[4])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return 1
`

/** Atomic room-subscribe guard: SISMEMBER + cap check + SADD in one call. */
const SUBSCRIBE_ROOM_LUA = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then
  return 1
end
local count = redis.call('SCARD', KEYS[1])
if count >= tonumber(ARGV[2]) then
  return -1
end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`

/**
 * Atomic unauthenticated-connection guard over global + per-IP counters;
 * rolls back its increments on rejection.
 */
const UNAUTH_LIMIT_LUA = `
local g = redis.call('INCR', KEYS[1])
if g == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3])) end
if g > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
local p = redis.call('INCR', KEYS[2])
if p == 1 then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3])) end
if p > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[2])
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`

const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return current
`

export class WsConnectionManager {
  private fallbackUnauthGlobal = 0
  private fallbackPerIpUnauth = new Map<string, number>()
  private fallbackConnsPerUser = new Map<string, Set<string>>()
  private fallbackRoomsPerUser = new Map<string, Set<string>>()
  private fallbackMsgRate = new Map<string, { count: number; reset: number }>()
  private fallbackTypingRate = new Map<string, { count: number; reset: number }>()
  private cleanupInterval: ReturnType<typeof setInterval>

  constructor(private readonly redis: Redis) {
    this.cleanupInterval = setInterval(
      () => {
        const now = Date.now()
        for (const [key, bucket] of this.fallbackMsgRate) {
          if (bucket.reset < now - 60000) {
            this.fallbackMsgRate.delete(key)
          }
        }
        for (const [key, bucket] of this.fallbackTypingRate) {
          if (bucket.reset < now - 60000) {
            this.fallbackTypingRate.delete(key)
          }
        }
      },
      5 * 60 * 1000,
    )
    this.cleanupInterval.unref?.()
  }

  async canAcceptUnauth(ip: string): Promise<boolean> {
    try {
      const result = (await this.redis.eval(
        UNAUTH_LIMIT_LUA,
        2,
        'ws:unauth:global',
        `ws:unauth:ip:${ip}`,
        String(WS_CONFIG.MAX_UNAUTH_GLOBAL),
        String(WS_CONFIG.MAX_UNAUTH_PER_IP),
        '120',
      )) as number
      return result === 1
    } catch {
      // Degraded in-memory fallback
      if (this.fallbackUnauthGlobal >= WS_CONFIG.MAX_UNAUTH_GLOBAL) return false
      const ipCount = this.fallbackPerIpUnauth.get(ip) || 0
      if (ipCount >= WS_CONFIG.MAX_UNAUTH_PER_IP) return false

      this.fallbackUnauthGlobal++
      this.fallbackPerIpUnauth.set(ip, ipCount + 1)
      return true
    }
  }

  async releaseUnauth(ip: string): Promise<void> {
    try {
      await this.redis.decr('ws:unauth:global')
      await this.redis.decr(`ws:unauth:ip:${ip}`)
    } catch {
      this.fallbackUnauthGlobal = Math.max(0, this.fallbackUnauthGlobal - 1)
      const ipCount = this.fallbackPerIpUnauth.get(ip) || 1
      this.fallbackPerIpUnauth.set(ip, Math.max(0, ipCount - 1))
    }
  }

  async canUserConnect(userId: string, connectionId: string): Promise<boolean> {
    try {
      const result = (await this.redis.eval(
        CONNECT_USER_LUA,
        1,
        `ws:connection_leases:user:${userId}`,
        String(Date.now()),
        String(USER_CONNECTION_LEASE_MS),
        String(WS_CONFIG.MAX_WS_CONNS_PER_USER),
        connectionId,
      )) as number
      return result === 1
    } catch {
      let connections = this.fallbackConnsPerUser.get(userId)
      if (!connections) {
        connections = new Set()
        this.fallbackConnsPerUser.set(userId, connections)
      }
      if (connections.has(connectionId)) return true
      if (connections.size >= WS_CONFIG.MAX_WS_CONNS_PER_USER) return false
      connections.add(connectionId)
      return true
    }
  }

  async releaseUserConnection(userId: string, connectionId: string): Promise<void> {
    try {
      await this.redis.zrem(`ws:connection_leases:user:${userId}`, connectionId)
    } catch {
      // The Redis lease expires if the server cannot reach Redis.
    } finally {
      const connections = this.fallbackConnsPerUser.get(userId)
      connections?.delete(connectionId)
      if (connections?.size === 0) {
        this.fallbackConnsPerUser.delete(userId)
      }
    }
  }

  async canSubscribeRoom(userId: string, roomId: string): Promise<boolean> {
    try {
      const key = `ws:user_rooms:${userId}`
      const result = (await this.redis.eval(
        SUBSCRIBE_ROOM_LUA,
        1,
        key,
        roomId,
        String(WS_CONFIG.MAX_ROOM_SUBS_PER_USER),
        '3600',
      )) as number
      return result === 1
    } catch {
      let rooms = this.fallbackRoomsPerUser.get(userId)
      if (!rooms) {
        rooms = new Set()
        this.fallbackRoomsPerUser.set(userId, rooms)
      }
      if (rooms.has(roomId)) return true
      if (rooms.size >= WS_CONFIG.MAX_ROOM_SUBS_PER_USER) return false
      rooms.add(roomId)
      return true
    }
  }

  async unsubscribeRoom(userId: string, roomId: string): Promise<void> {
    try {
      await this.redis.srem(`ws:user_rooms:${userId}`, roomId)
    } catch {
      const rooms = this.fallbackRoomsPerUser.get(userId)
      if (rooms) {
        rooms.delete(roomId)
        if (rooms.size === 0) this.fallbackRoomsPerUser.delete(userId)
      }
    }
  }

  async checkMessageRateLimit(userId: string): Promise<boolean> {
    try {
      const key = `ratelimit:ws_msg:${userId}`
      const current = (await this.redis.eval(RATE_LIMIT_LUA, 1, key, '10')) as number
      return current <= 10
    } catch {
      const now = Date.now()
      const item = this.fallbackMsgRate.get(userId)
      if (!item || item.reset < now) {
        this.fallbackMsgRate.set(userId, { count: 1, reset: now + 10000 })
        return true
      }
      if (item.count >= 10) return false
      item.count++
      return true
    }
  }

  async checkTypingRateLimit(userId: string): Promise<boolean> {
    try {
      const key = `ratelimit:ws_typing:${userId}`
      const current = (await this.redis.eval(RATE_LIMIT_LUA, 1, key, '10')) as number
      return current <= 5
    } catch {
      const now = Date.now()
      const item = this.fallbackTypingRate.get(userId)
      if (!item || item.reset < now) {
        this.fallbackTypingRate.set(userId, { count: 1, reset: now + 10000 })
        return true
      }
      if (item.count >= 5) return false
      item.count++
      return true
    }
  }
}
