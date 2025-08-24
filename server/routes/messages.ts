import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { handleAsyncOperation } from '../lib/helpers';
import {
    ErrorCode,
    handleError,
    createAuthError,
    createUserNotFoundError,
} from '../lib/errors';
import type { AuthenticatedRequest } from '../lib/types';
import z from 'zod';
import { usernameSchema } from '../lib/validation';

export const messageSchema = z.object({
    to: usernameSchema,
    text: z
        .string()
        .min(1, 'Message text cannot be empty')
        .max(2000, 'Message too long'),
});

export const getMessagesSchema = z.object({
    from: usernameSchema,
});

export default async function (server: FastifyInstance) {
    const { redis } = server;

    // Send message endpoint
    server.withTypeProvider<ZodTypeProvider>().post(
        '/send-message',
        {
            schema: { body: messageSchema },
            preHandler: [server.authenticate],
        },
        async (request, reply) => {
            try {
                const message = request.body;
                const username = (request as AuthenticatedRequest).username;
                const recipientUsername = message.to;

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

                const key = `${recipientUsername}:messages:${username}`;

                const messageWithTimestamp = {
                    text: message.text,
                    timestamp: new Date().toISOString(),
                    id: crypto.randomUUID(),
                };

                await handleAsyncOperation(
                    async () => {
                        await redis.rpush(
                            key,
                            JSON.stringify(messageWithTimestamp),
                        );
                    },
                    'Failed to send message',
                    ErrorCode.DATABASE_ERROR,
                );

                reply.code(200).send(messageWithTimestamp);
            } catch (error) {
                const response = handleError(error, server);
                const statusCode =
                    response.code === ErrorCode.UNAUTHORIZED
                        ? 401
                        : response.code === ErrorCode.USER_NOT_FOUND
                          ? 404
                          : 500;
                reply.code(statusCode).send(response);
            }
        },
    );

    // Get messages endpoint
    server.withTypeProvider<ZodTypeProvider>().get(
        '/get-messages',
        {
            schema: { querystring: getMessagesSchema },
            preHandler: [server.authenticate],
        },
        async (request, reply) => {
            try {
                const username = (request as AuthenticatedRequest).username;
                const { from } = request.query;
                const key = `${username}:messages:${from}`;

                const messagesRaw = await handleAsyncOperation(
                    () => redis.lrange(key, 0, -1),
                    'Failed to retrieve messages',
                    ErrorCode.DATABASE_ERROR,
                );

                const messages = messagesRaw
                    .map((msg: string) => {
                        try {
                            return JSON.parse(msg);
                        } catch {
                            server.log.warn('Failed to parse message:', msg);
                            return null;
                        }
                    })
                    .filter(Boolean);

                reply.code(200).send(messages);
            } catch (error) {
                const response = handleError(error, server);
                reply.code(500).send(response);
            }
        },
    );
}
