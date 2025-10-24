import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';

import {
  ErrorCode,
  createAuthError,
  createUserNotFoundError,
} from '@/lib/errors.ts';
import { handleAsyncOperation } from '@/lib/helpers.ts';
import { sendPushNotification } from '@/lib/notification.ts';
import { usernameSchema } from '@/validation/validation.ts';

const sendMessageSchema = z.object({
  to: usernameSchema,
  text: z
    .string()
    .min(1, 'Message text cannot be empty')
    .max(2000, 'Message too long'),
});

const getMessagesSchema = z.object({
  from: usernameSchema,
  after: z
    .string()
    .regex(/^\d+$/, 'Must be a non-negative integer string')
    .transform((val) => parseInt(val, 10))
    .optional(),
  before: z
    .string()
    .regex(/^[1-9]\d*$/, 'Must be a positive integer string')
    .transform((val) => parseInt(val, 10))
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, 'Must be a positive integer')
    .transform((val) => Math.min(parseInt(val, 10), 100))
    .optional()
    .default(50),
});

type Message = {
  from: string;
  to: string;
  text: string;
  timestamp: string;
};

const getMessageKey = (user1: string, user2: string) => {
  return user1 > user2 ? `${user1}+${user2}` : `${user2}+${user1}`;
};

export function messageRoutes(server: FastifyInstance) {
  const { redis } = server;

  server.withTypeProvider<ZodTypeProvider>().post(
    '/send-message',
    {
      schema: { body: sendMessageSchema },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const { to: recipientUsername, text } = request.body;
      const { username } = request;

      const recipientExists = await handleAsyncOperation(
        () => redis.exists(recipientUsername),
        'Failed to check recipient existence',
        ErrorCode.DATABASE_ERROR,
      );

      if (!recipientExists) {
        throw createUserNotFoundError(recipientUsername);
      }

      const recipientOthersKey = `${recipientUsername}:others`;
      const recipientOthers = await handleAsyncOperation(
        () => redis.lrange(recipientOthersKey, 0, -1),
        'Failed to retrieve recipient data',
        ErrorCode.DATABASE_ERROR,
      );

      if (!recipientOthers.includes(username)) {
        throw createAuthError(
          'You are not authorized to send messages to this user.',
        );
      }

      const key = getMessageKey(username, recipientUsername);

      const message: Message = {
        from: username,
        to: recipientUsername,
        text,
        timestamp: new Date().toISOString(),
      };

      // Get the index before pushing (current length will be the new message's index)
      const messageIndex = await handleAsyncOperation(
        () => redis.llen(key),
        'Failed to get message count',
        ErrorCode.DATABASE_ERROR,
      );

      await handleAsyncOperation(
        () => redis.rpush(key, JSON.stringify(message)),
        'Failed to send message',
        ErrorCode.DATABASE_ERROR,
      );

      // Try to send push notification if recipient has a push token (Android only)
      const pushToken = await redis.get(`${recipientUsername}:pushtoken`);
      if (pushToken) {
        void sendPushNotification({
          expoPushToken: pushToken,
          senderUsername: username,
          messageText: text,
          messageIndex,
          timestamp: message.timestamp,
        });
      }

      reply.send({
        index: messageIndex,
        ...message,
      });
    },
  );

  server.withTypeProvider<ZodTypeProvider>().get(
    '/get-messages',
    {
      schema: { querystring: getMessagesSchema },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      const { username } = request;
      const { from, after, before, limit } = request.query;

      const key = getMessageKey(username, from);

      // Get total message count
      const totalCount = await handleAsyncOperation(
        () => redis.llen(key),
        'Failed to get message count',
        ErrorCode.DATABASE_ERROR,
      );

      let start: number;
      let end: number;

      if (after !== undefined) {
        // Get messages AFTER a specific index (for polling new messages)
        start = after + 1;
        end = -1; // Get all new messages
      } else if (before !== undefined) {
        // Get messages BEFORE a specific index (for loading older messages)
        end = before - 1;
        start = Math.max(0, end - limit + 1);
      } else {
        // Initial load: Get the most recent messages
        end = -1;
        start = Math.max(0, totalCount - limit);
      }

      const messagesRaw = await handleAsyncOperation(
        () => redis.lrange(key, start, end),
        'Failed to retrieve messages',
        ErrorCode.DATABASE_ERROR,
      );

      const messages = messagesRaw.map((message, index) => {
        return {
          index: start + index,
          ...(JSON.parse(message) as Message),
        };
      });

      // hasMore logic:
      // - If polling for new messages (after param), hasMore is always false
      // - Otherwise, hasMore is true if there are older messages (start > 0)
      const hasMore = after !== undefined ? false : start > 0;

      reply.send({
        messages,
        hasMore,
        totalCount,
      });
    },
  );
}
