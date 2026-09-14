import type { FastifyRedis } from '@fastify/redis';

import { LOGIN_CONFIG } from '@/lib/config.ts';
import { createDatabaseError } from '@/lib/errors.ts';
import type { Conversation, Message } from '@/types/models.ts';

// Re-export for consumers
export type {
  Message,
  Conversation,
  MessageType,
  Attachment,
} from '@/types/models.ts';

// ─────────────────────────────────────────────────────────────
// Redis Keys
// ─────────────────────────────────────────────────────────────

/**
 * Redis key patterns with consistent namespacing.
 */
export const RedisKeys = {
  // User keys
  user: (username: string) => `user:${username}`,
  loginAttempts: (username: string) => `ratelimit:login:${username}`,
  pushToken: (username: string) => `user:${username}:pushtoken`,
  contacts: (username: string) => `user:${username}:contacts`,
  userConversations: (username: string) => `user:${username}:conversations`,

  // Conversation keys
  conversation: (id: string) => `conversation:${id}`,
  conversationMessages: (id: string) => `conversation:${id}:messages`,

  // DM lookup (for finding existing 1:1 conversation)
  dmLookup: (user1: string, user2: string) => {
    const sorted = [user1, user2].sort();
    return `dm:lookup:${sorted[0]}:${sorted[1]}`;
  },
} as const;

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export class RedisService {
  constructor(private redis: FastifyRedis) {}

  // ─────────────────────────────────────────────────────────────
  // Auth Operations
  // ─────────────────────────────────────────────────────────────

  async checkRateLimit(username: string): Promise<boolean> {
    try {
      const key = RedisKeys.loginAttempts(username);
      const attempts = await this.redis.get(key);
      return !attempts || parseInt(attempts) < LOGIN_CONFIG.MAX_LOGIN_ATTEMPTS;
    } catch (error) {
      throw createDatabaseError('rate limit check', error as Error);
    }
  }

  async incrementLoginAttempts(username: string): Promise<void> {
    try {
      const key = RedisKeys.loginAttempts(username);
      const current = await this.redis.incr(key);
      if (current === 1) {
        await this.redis.expire(key, LOGIN_CONFIG.LOCKOUT_DURATION / 1000);
      }
    } catch (error) {
      throw createDatabaseError('increment login attempts', error as Error);
    }
  }

  async clearLoginAttempts(username: string): Promise<void> {
    try {
      await this.redis.del(RedisKeys.loginAttempts(username));
    } catch (error) {
      throw createDatabaseError('clear login attempts', error as Error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // User Operations
  // ─────────────────────────────────────────────────────────────

  async createUser(username: string, hash: string): Promise<'OK' | null> {
    return this.redis.set(RedisKeys.user(username), hash, 'NX');
  }

  async getUser(username: string): Promise<string | null> {
    return this.redis.get(RedisKeys.user(username));
  }

  async checkUserExists(username: string): Promise<boolean> {
    const exists = await this.redis.exists(RedisKeys.user(username));
    return exists === 1;
  }

  // ─────────────────────────────────────────────────────────────
  // Push Token Operations
  // ─────────────────────────────────────────────────────────────

  async setPushToken(username: string, token: string): Promise<void> {
    await this.redis.set(RedisKeys.pushToken(username), token);
  }

  async getPushToken(username: string): Promise<string | null> {
    return this.redis.get(RedisKeys.pushToken(username));
  }

  async deletePushToken(username: string): Promise<void> {
    await this.redis.del(RedisKeys.pushToken(username));
  }

  // ─────────────────────────────────────────────────────────────
  // Contacts Operations
  // ─────────────────────────────────────────────────────────────

  async getContacts(username: string): Promise<string[]> {
    return this.redis.smembers(RedisKeys.contacts(username));
  }

  async addContact(username: string, contact: string): Promise<number> {
    return this.redis.sadd(RedisKeys.contacts(username), contact);
  }

  async removeContact(username: string, contact: string): Promise<number> {
    return this.redis.srem(RedisKeys.contacts(username), contact);
  }

  async hasContact(username: string, contact: string): Promise<boolean> {
    const result = await this.redis.sismember(
      RedisKeys.contacts(username),
      contact,
    );
    return result === 1;
  }

  // ─────────────────────────────────────────────────────────────
  // Conversation Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new conversation (DM or group)
   */
  async createConversation(conversation: Conversation): Promise<void> {
    const key = RedisKeys.conversation(conversation.id);
    await this.redis.hset(key, {
      id: conversation.id,
      participants: JSON.stringify(conversation.participants),
      isGroup: conversation.isGroup ? '1' : '0',
      name: conversation.name ?? '',
      createdAt: conversation.createdAt,
    });

    // Add to each participant's conversation list
    for (const participant of conversation.participants) {
      await this.redis.sadd(
        RedisKeys.userConversations(participant),
        conversation.id,
      );
    }
  }

  /**
   * Get conversation by ID
   */
  async getConversation(id: string): Promise<Conversation | null> {
    const data = await this.redis.hgetall(RedisKeys.conversation(id));
    if (!data || !data['id']) return null;

    const name = data['name'];
    return {
      id: data['id'],
      participants: JSON.parse(
        (data['participants'] as string) ?? '[]',
      ) as string[],
      isGroup: data['isGroup'] === '1',
      ...(name ? { name: name } : {}),
      createdAt: (data['createdAt'] as string) ?? '',
    };
  }

  /**
   * Get all conversation IDs for a user
   */
  async getUserConversationIds(username: string): Promise<string[]> {
    return this.redis.smembers(RedisKeys.userConversations(username));
  }

  /**
   * Get all conversations for a user (full details)
   */
  async getUserConversations(username: string): Promise<Conversation[]> {
    const ids = await this.getUserConversationIds(username);
    const conversations: Conversation[] = [];

    for (const id of ids) {
      const conv = await this.getConversation(id);
      if (conv) conversations.push(conv);
    }

    return conversations;
  }

  /**
   * Check if user is participant in conversation
   */
  async isParticipant(
    conversationId: string,
    username: string,
  ): Promise<boolean> {
    const conv = await this.getConversation(conversationId);
    if (!conv) return false;
    return conv.participants.includes(username);
  }

  /**
   * Find existing DM between two users
   */
  async findDmConversation(
    user1: string,
    user2: string,
  ): Promise<string | null> {
    return this.redis.get(RedisKeys.dmLookup(user1, user2));
  }

  /**
   * Store DM lookup for quick access
   */
  async setDmLookup(
    user1: string,
    user2: string,
    conversationId: string,
  ): Promise<void> {
    await this.redis.set(RedisKeys.dmLookup(user1, user2), conversationId);
  }

  // ─────────────────────────────────────────────────────────────
  // Message Operations
  // ─────────────────────────────────────────────────────────────

  async getMessageCount(conversationId: string): Promise<number> {
    return this.redis.llen(RedisKeys.conversationMessages(conversationId));
  }

  async saveMessage(conversationId: string, message: Message): Promise<number> {
    return this.redis.rpush(
      RedisKeys.conversationMessages(conversationId),
      JSON.stringify(message),
    );
  }

  async getMessages(
    conversationId: string,
    start: number,
    end: number,
  ): Promise<string[]> {
    return this.redis.lrange(
      RedisKeys.conversationMessages(conversationId),
      start,
      end,
    );
  }
}
