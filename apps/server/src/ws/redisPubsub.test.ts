import { expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import type Redis from 'ioredis'

import { RedisPubsub, roomChannel } from './redisPubsub.ts'

it('forwards pattern subscription messages to local sockets', async () => {
  const subscriber = Object.assign(new EventEmitter(), {
    connect: async () => undefined,
    psubscribe: async () => 1,
    punsubscribe: async () => 0,
    quit: async () => 'OK',
  })
  const redis = {
    status: 'ready',
    duplicate: () => subscriber,
    publish: async (channel: string, message: string) => {
      subscriber.emit('pmessage', 'meapp:room*', channel, message)
      return 1
    },
  } as unknown as Redis
  const pubsub = new RedisPubsub(redis)
  const received: [string, string][] = []

  await pubsub.start((channel, message) => received.push([channel, message]))
  await pubsub.publish(roomChannel('room-1'), 'hello')

  expect(received).toEqual([[roomChannel('room-1'), 'hello']])
  await pubsub.stop()
})
