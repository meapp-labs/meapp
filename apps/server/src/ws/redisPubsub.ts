import type Redis from 'ioredis'

/**
 * Cross-instance Redis pub/sub bridge for WebSocket fan-out.
 *
 * Elysia's ws.publish only reaches sockets connected to THIS process, so
 * broadcasts are mirrored via Redis and re-published locally by each replica.
 * Channel names (meapp:room:{id}) are mapped back to Elysia topics (room:{id})
 * by the consumer in chat.ts. Degrades to local-only fan-out if Redis is down.
 */
export class RedisPubsub {
  private subscriber: Redis | null = null
  private started = false

  constructor(private readonly redis: Redis) {}

  async start(publishLocal: (channel: string, message: string) => void): Promise<void> {
    if (this.started) return
    this.started = true

    try {
      if (this.redis.status !== 'ready') {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 3000)
          this.redis.once('ready', () => {
            clearTimeout(timeout)
            resolve()
          })
          this.redis.once('error', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      }

      this.subscriber = this.redis.duplicate()
      this.subscriber.on('error', () => {})
      this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
        publishLocal(channel, message)
      })
      // lazyConnect carries over to duplicates — connect explicitly.
      await this.subscriber.connect()
      await this.subscriber.psubscribe('meapp:room*')
    } catch (err) {
      console.warn('[RedisPubsub] Bridge unavailable, running in local-only mode:', err)
      this.subscriber = null
    }
  }

  async publish(channel: string, message: string): Promise<boolean> {
    try {
      if (this.redis.status === 'ready') {
        await this.redis.publish(channel, message)
        return this.subscriber?.status === 'ready'
      }
    } catch {}
    return false
  }

  async stop(): Promise<void> {
    try {
      if (this.subscriber) {
        await this.subscriber.punsubscribe('meapp:room*')
        await this.subscriber.quit()
      }
    } catch {}
    this.subscriber = null
    this.started = false
  }
}

export const roomChannel = (roomId: string) => `meapp:room:${roomId}`
export const roomTypingChannel = (roomId: string) => `meapp:room-typing:${roomId}`
