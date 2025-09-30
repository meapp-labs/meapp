import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';

import {
    createAuthError,
    createUserNotFoundError,
    ErrorCode,
} from '../lib/errors';
import { handleAsyncOperation } from '../lib/helpers';
import { usernameSchema } from '../validation/validation';

const sendMessageSchema = z.object({
    to: usernameSchema,
    text: z
        .string()
        .min(1, 'Message text cannot be empty')
        .max(2000, 'Message too long'),
});

const getMessagesSchema = z.object({
    from: usernameSchema,
    index: z
        .string()
        .regex(/^[1-9]\d*$/, 'Must be a positive integer string')
        .transform((val) => parseInt(val, 10))
        .optional(),
});

const getMessageKey = (user1: string, user2: string) => {
    return user1 > user2 ? `${user1}+${user2}` : `${user2}+${user1}`;
};

export async function messageRoutes(server: FastifyInstance) {
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

            await handleAsyncOperation(
                () => redis.rpush(key),
                'Failed to send message',

                ErrorCode.DATABASE_ERROR,
            );

            reply.send();
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
            const { from, index: lastMessageIndex = 0 } = request.query;

            const key = getMessageKey(username, from);

            const messagesRaw = await handleAsyncOperation(
                () => redis.lrange(key, lastMessageIndex ?? 0, -1),
                'Failed to retrieve messages',
                ErrorCode.DATABASE_ERROR,
            );

            const messages = messagesRaw.map((message, index) => {
                return {
                    index: index + lastMessageIndex,
                    ...(JSON.parse(message) as Boolean),
                };
            });

            reply.send(messages);
        },
    );
}
