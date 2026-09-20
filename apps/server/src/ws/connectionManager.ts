import type Redis from 'ioredis'
import { WS_CONFIG } from '../lib/config.ts'

export type WsSessionState = {
  authenticatedUserId?: string | undefined
  ip: string
  authTimeoutTimer?: ReturnType<typeof setTimeout> | undefined
  subscribedRooms: Set<string>
}

export class WsConnectionManager {
  private fallbackUnauthGlobal = 0
  private fallbackPerIpUnauth = new Map<string, number>()
  private fallbackConnsPerUser = new Map<string, number>()
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
      const globalKey = 'ws:unauth:global'
      const ipKey = `ws:unauth:ip:${ip}`

      const currentGlobal = await this.redis.incr(globalKey)
      if (currentGlobal === 1) await this.redis.expire(globalKey, 120)

      if (currentGlobal > WS_CONFIG.MAX_UNAUTH_GLOBAL) {
        await this.redis.decr(globalKey)
        return false
      }

      const currentIp = await this.redis.incr(ipKey)
      if (currentIp === 1) await this.redis.expire(ipKey, 120)

      if (currentIp > WS_CONFIG.MAX_UNAUTH_PER_IP) {
        await this.redis.decr(ipKey)
        await this.redis.decr(globalKey)
        return false
      }

      return true
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

  async canUserConnect(userId: string): Promise<boolean> {
    try {
      const key = `ws:conns:user:${userId}`
      const current = await this.redis.incr(key)
      if (current === 1) await this.redis.expire(key, 3600)

      if (current > WS_CONFIG.MAX_WS_CONNS_PER_USER) {
        await this.redis.decr(key)
        return false
      }
      return true
    } catch {
      const current = this.fallbackConnsPerUser.get(userId) || 0
      if (current >= WS_CONFIG.MAX_WS_CONNS_PER_USER) return false
      this.fallbackConnsPerUser.set(userId, current + 1)
      return true
    }
  }

  async releaseUserConnection(userId: string): Promise<void> {
    try {
      const key = `ws:conns:user:${userId}`
      const remaining = await this.redis.decr(key)
      if (remaining <= 0) {
        await this.redis.del(key)
      }
    } catch {
      const current = this.fallbackConnsPerUser.get(userId) || 1
      const updated = Math.max(0, current - 1)
      if (updated === 0) {
        this.fallbackConnsPerUser.delete(userId)
      } else {
        this.fallbackConnsPerUser.set(userId, updated)
      }
    }
  }

  async canSubscribeRoom(userId: string, roomId: string): Promise<boolean> {
    try {
      const key = `ws:user_rooms:${userId}`
      const isMember = await this.redis.sismember(key, roomId)
      if (isMember) return true

      const count = await this.redis.scard(key)
      if (count >= WS_CONFIG.MAX_ROOM_SUBS_PER_USER) {
        return false
      }

      await this.redis.sadd(key, roomId)
      await this.redis.expire(key, 3600)
      return true
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

  async releaseAllUserSubscriptions(userId: string): Promise<void> {
    try {
      await this.redis.del(`ws:user_rooms:${userId}`)
    } catch {
      this.fallbackRoomsPerUser.delete(userId)
    }
  }

  async checkMessageRateLimit(userId: string): Promise<boolean> {
    try {
      const key = `ratelimit:ws_msg:${userId}`
      const current = await this.redis.incr(key)
      if (current === 1) await this.redis.expire(key, 10)
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
      const current = await this.redis.incr(key)
      if (current === 1) await this.redis.expire(key, 10)
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
