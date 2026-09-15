import type { Conversation } from '@meapp/shared'
import type Redis from 'ioredis'

import { LOGIN_CONFIG } from '../lib/config.ts'
import { createDatabaseError } from '../lib/errors.ts'

/**
 * Message shape stored in Redis. Deliberately distinct from the shared `Message`
 * schema, which describes the newer room/sequence model.
 */
export type StoredMessage = {
  id: string
  from: string
  text: string
  type: string
  timestamp: string
}

/**
 * Redis key patterns. These are unchanged from the Fastify implementation so that
 * accounts, contacts, conversations and message history survive the migration.
 */
export const RedisKeys = {
  user: (username: string) => `user:${username}`,
  loginAttempts: (username: string) => `ratelimit:login:${username}`,
  pushToken: (username: string) => `user:${username}:pushtoken`,
  contacts: (username: string) => `user:${username}:contacts`,
  userConversations: (username: string) => `user:${username}:conversations`,

  conversation: (id: string) => `conversation:${id}`,
  conversationMessages: (id: string) => `conversation:${id}:messages`,

  dmLookup: (user1: string, user2: string) => {
    const sorted = [user1, user2].sort()
    return `dm:lookup:${sorted[0]}:${sorted[1]}`
  },
} as const

export class RedisService {
  constructor(private readonly redis: Redis) {}

  // ── Auth ───────────────────────────────────────────────────

  async checkRateLimit(username: string): Promise<boolean> {
    try {
      const attempts = await this.redis.get(RedisKeys.loginAttempts(username))
      return !attempts || Number.parseInt(attempts, 10) < LOGIN_CONFIG.MAX_LOGIN_ATTEMPTS
    } catch (error) {
      throw createDatabaseError('rate limit check', error as Error)
    }
  }

  async incrementLoginAttempts(username: string): Promise<void> {
    try {
      const key = RedisKeys.loginAttempts(username)
      const current = await this.redis.incr(key)
      if (current === 1) {
        await this.redis.expire(key, LOGIN_CONFIG.LOCKOUT_DURATION_MS / 1000)
      }
    } catch (error) {
      throw createDatabaseError('increment login attempts', error as Error)
    }
  }

  async clearLoginAttempts(username: string): Promise<void> {
    try {
      await this.redis.del(RedisKeys.loginAttempts(username))
    } catch (error) {
      throw createDatabaseError('clear login attempts', error as Error)
    }
  }

  // ── Users ──────────────────────────────────────────────────

  /** `salt:hash` for the given username, or null when the user does not exist. */
  async createUser(username: string, hash: string): Promise<'OK' | null> {
    return this.redis.set(RedisKeys.user(username), hash, 'NX')
  }

  async getUser(username: string): Promise<string | null> {
    return this.redis.get(RedisKeys.user(username))
  }

  async checkUserExists(username: string): Promise<boolean> {
    return (await this.redis.exists(RedisKeys.user(username))) === 1
  }

  // ── Push tokens ────────────────────────────────────────────

  async setPushToken(username: string, token: string): Promise<void> {
    await this.redis.set(RedisKeys.pushToken(username), token)
  }

  async getPushToken(username: string): Promise<string | null> {
    return this.redis.get(RedisKeys.pushToken(username))
  }

  async deletePushToken(username: string): Promise<void> {
    await this.redis.del(RedisKeys.pushToken(username))
  }

  // ── Contacts ───────────────────────────────────────────────

  async getContacts(username: string): Promise<string[]> {
    return this.redis.smembers(RedisKeys.contacts(username))
  }

  async addContact(username: string, contact: string): Promise<number> {
    return this.redis.sadd(RedisKeys.contacts(username), contact)
  }

  async removeContact(username: string, contact: string): Promise<number> {
    return this.redis.srem(RedisKeys.contacts(username), contact)
  }

  async hasContact(username: string, contact: string): Promise<boolean> {
    return (await this.redis.sismember(RedisKeys.contacts(username), contact)) === 1
  }

  // ── Conversations ──────────────────────────────────────────

  async createConversation(conversation: Conversation): Promise<void> {
    await this.redis.hset(RedisKeys.conversation(conversation.id), {
      id: conversation.id,
      participants: JSON.stringify(conversation.participants),
      isGroup: conversation.isGroup ? '1' : '0',
      name: conversation.name ?? '',
      createdAt: conversation.createdAt,
    })

    for (const participant of conversation.participants) {
      await this.redis.sadd(RedisKeys.userConversations(participant), conversation.id)
    }
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const data = await this.redis.hgetall(RedisKeys.conversation(id))
    const conversationId = data.id
    if (!conversationId) return null

    const name = data.name
    return {
      id: conversationId,
      participants: JSON.parse(data.participants ?? '[]') as string[],
      isGroup: data.isGroup === '1',
      ...(name ? { name } : {}),
      createdAt: data.createdAt ?? '',
    }
  }

  async getUserConversationIds(username: string): Promise<string[]> {
    return this.redis.smembers(RedisKeys.userConversations(username))
  }

  async getUserConversations(username: string): Promise<Conversation[]> {
    const ids = await this.getUserConversationIds(username)
    const conversations: Conversation[] = []

    for (const id of ids) {
      const conversation = await this.getConversation(id)
      if (conversation) conversations.push(conversation)
    }

    return conversations
  }

  async isParticipant(conversationId: string, username: string): Promise<boolean> {
    const conversation = await this.getConversation(conversationId)
    if (!conversation) return false
    return conversation.participants.includes(username)
  }

  async findDmConversation(user1: string, user2: string): Promise<string | null> {
    return this.redis.get(RedisKeys.dmLookup(user1, user2))
  }

  async setDmLookup(user1: string, user2: string, conversationId: string): Promise<void> {
    await this.redis.set(RedisKeys.dmLookup(user1, user2), conversationId)
  }

  // ── Messages ───────────────────────────────────────────────

  async getMessageCount(conversationId: string): Promise<number> {
    return this.redis.llen(RedisKeys.conversationMessages(conversationId))
  }

  async saveMessage(conversationId: string, message: StoredMessage): Promise<number> {
    return this.redis.rpush(RedisKeys.conversationMessages(conversationId), JSON.stringify(message))
  }

  /** Inclusive index range, matching Redis LRANGE semantics (end = -1 is the last element). */
  async getMessages(conversationId: string, start: number, end: number): Promise<string[]> {
    return this.redis.lrange(RedisKeys.conversationMessages(conversationId), start, end)
  }
}
