import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';

import {
  ApiError,
  ErrorCode,
  createAuthError,
  createUserNotFoundError,
  handleError,
} from '@/lib/errors.ts';
import { sendPushNotification } from '@/lib/notification.ts';
import type { Conversation, Message } from '@/services/redis.service.ts';
import { usernameSchema } from '@/validation/validation.ts';

// ─────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────

const createConversationSchema = z.object({
  type: z.enum(['dm', 'group']),
  participants: z.array(usernameSchema).min(1).max(50),
  name: z.string().max(100).optional(),
});

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  text: z
    .string()
    .min(1, 'Message text cannot be empty')
    .max(2000, 'Message too long'),
});

const getMessagesSchema = z.object({
  conversationId: z.string().uuid(),
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

// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────

export function messageRoutes(server: FastifyInstance) {
  const { redisService } = server;

  // ─────────────────────────────────────────────────────────────
  // Create Conversation
  // ─────────────────────────────────────────────────────────────

  server.withTypeProvider<ZodTypeProvider>().post(
    '/conversations',
    {
      schema: { body: createConversationSchema },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      try {
        const { type, participants, name } = request.body;
        const { username } = request;

        // Add current user to participants if not already included
        const allParticipants = participants.includes(username)
          ? participants
          : [username, ...participants];

        // Verify all participants exist
        for (const participant of allParticipants) {
          if (participant !== username) {
            const exists = await redisService.checkUserExists(participant);
            if (!exists) {
              throw createUserNotFoundError(participant);
            }
          }
        }

        // For DMs, check if conversation already exists
        if (type === 'dm') {
          if (allParticipants.length !== 2) {
            throw new ApiError(
              ErrorCode.VALIDATION_ERROR,
              'DM must have exactly 2 participants',
              400,
            );
          }

          const existingId = await redisService.findDmConversation(
            allParticipants[0] as string,
            allParticipants[1] as string,
          );

          if (existingId) {
            const existing = await redisService.getConversation(existingId);
            reply.code(200).send(existing);
            return;
          }
        }

        // Create new conversation
        const conversation: Conversation = {
          id: randomUUID(),
          participants: allParticipants,
          isGroup: type === 'group',
          ...(type === 'group' && name ? { name } : {}),
          createdAt: new Date().toISOString(),
        };

        await redisService.createConversation(conversation);

        // For DMs, store lookup
        if (type === 'dm') {
          await redisService.setDmLookup(
            allParticipants[0] as string,
            allParticipants[1] as string,
            conversation.id,
          );
        }

        reply.code(201).send(conversation);
      } catch (error) {
        const response = handleError(error, server);
        reply.code(response.statusCode).send(response);
      }
    },
  );

  // ─────────────────────────────────────────────────────────────
  // Get User's Conversations
  // ─────────────────────────────────────────────────────────────

  server.get(
    '/conversations',
    { preHandler: [server.authenticate] },
    async (request, reply) => {
      try {
        const { username } = request;
        const conversations = await redisService.getUserConversations(username);
        reply.code(200).send(conversations);
      } catch (error) {
        const response = handleError(error, server);
        reply.code(500).send(response);
      }
    },
  );

  // ─────────────────────────────────────────────────────────────
  // Send Message
  // ─────────────────────────────────────────────────────────────

  server.withTypeProvider<ZodTypeProvider>().post(
    '/send-message',
    {
      schema: { body: sendMessageSchema },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      try {
        const { conversationId, text } = request.body;
        const { username } = request;

        // Verify user is participant
        const isParticipant = await redisService.isParticipant(
          conversationId,
          username,
        );
        if (!isParticipant) {
          throw createAuthError(
            'You are not a participant in this conversation',
          );
        }

        const conversation = await redisService.getConversation(conversationId);
        if (!conversation) {
          throw new ApiError(
            ErrorCode.ITEM_NOT_FOUND,
            'Conversation not found',
            404,
          );
        }

        const message: Message = {
          id: randomUUID(),
          from: username,
          text,
          type: 'text',
          timestamp: new Date().toISOString(),
        };

        // Get message index before saving
        const messageIndex = await redisService.getMessageCount(conversationId);
        await redisService.saveMessage(conversationId, message);

        // Send push notifications to other participants
        for (const participant of conversation.participants) {
          if (participant !== username) {
            const pushToken = await redisService.getPushToken(participant);
            if (pushToken) {
              void sendPushNotification({
                expoPushToken: pushToken,
                senderUsername: username,
                messageText: text,
                messageIndex,
                timestamp: message.timestamp,
              });
            }
          }
        }

        reply.send({
          index: messageIndex,
          ...message,
        });
      } catch (error) {
        const response = handleError(error, server);
        reply.code(response.statusCode).send(response);
      }
    },
  );

  // ─────────────────────────────────────────────────────────────
  // Get Messages
  // ─────────────────────────────────────────────────────────────

  server.withTypeProvider<ZodTypeProvider>().get(
    '/get-messages',
    {
      schema: { querystring: getMessagesSchema },
      preHandler: [server.authenticate],
    },
    async (request, reply) => {
      try {
        const { username } = request;
        const { conversationId, after, before, limit } = request.query;

        // Verify user is participant
        const isParticipant = await redisService.isParticipant(
          conversationId,
          username,
        );
        if (!isParticipant) {
          throw createAuthError(
            'You are not a participant in this conversation',
          );
        }

        const totalCount = await redisService.getMessageCount(conversationId);

        let start: number;
        let end: number;

        if (after !== undefined) {
          start = after + 1;
          end = start + limit - 1;
        } else if (before !== undefined) {
          end = before - 1;
          start = Math.max(0, end - limit + 1);
        } else {
          end = -1;
          start = Math.max(0, totalCount - limit);
        }

        const messagesRaw = await redisService.getMessages(
          conversationId,
          start,
          end,
        );

        const messages = messagesRaw.map((msg, index) => ({
          index: start + index,
          ...(JSON.parse(msg) as Message),
        }));

        const hasMore =
          after !== undefined
            ? start + messages.length < totalCount
            : start > 0;

        reply.send({
          messages,
          hasMore,
          totalCount,
        });
      } catch (error) {
        const response = handleError(error, server);
        reply.code(response.statusCode).send(response);
      }
    },
  );
}
