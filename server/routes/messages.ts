import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { handleAsyncOperation } from '../lib/helpers';
import {
    ErrorCode,
    createAuthError,
    createUserNotFoundError,
} from '../lib/errors';
import z from 'zod';
import { usernameSchema } from '../lib/validation';

export const sendMessageSchema = z.object({
    to: usernameSchema,
    text: z
        .string()
        .min(1, 'Message text cannot be empty')
        .max(2000, 'Message too long'),
});

export const getMessagesSchema = z.object({
    from: usernameSchema,
});

const getMessageKey = (user1: string, user2: string) => {
    return user1 > user2 ? `${user1}:${user2}` : `${user2}:${user1}`;
};

export default async function (server: FastifyInstance) {
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

            const message = {
                from: username,
                to: recipientUsername,
                text,
                timestamp: new Date().toISOString(),
            };

            await handleAsyncOperation(
                () => redis.rpush(key, JSON.stringify(message)),
                'Failed to send message',
                ErrorCode.DATABASE_ERROR,
            );

            reply.send(message);
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
            const { from } = request.query;

            const key = getMessageKey(username, from);

            const messagesRaw = await handleAsyncOperation(
                () => redis.lrange(key, 0, -1),
                'Failed to retrieve messages',
                ErrorCode.DATABASE_ERROR,
            );

            const messages = messagesRaw.map((message) => JSON.parse(message));

            reply.send(messages);
        },
    );
}
