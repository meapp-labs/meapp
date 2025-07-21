import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { LOGIN_CONFIG } from '../lib/config';
import { handleAsyncOperation } from '../lib/helpers';
import { ErrorCode, handleError } from '../lib/errors';
import { createSuccessResponse } from '../lib/responses';
import type { AuthenticatedRequest } from '../lib/types';
import z from 'zod';

export const messageSchema = z.object({
    from: z
        .string()
        .min(1, 'From field cannot be empty')
        .max(50, 'From field too long'),
    text: z
        .string()
        .min(1, 'Message text cannot be empty')
        .max(2000, 'Message too long'),
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
                const key = `${username}:messages`;

                const messageWithTimestamp = {
                    ...message,
                    timestamp: new Date().toISOString(),
                    id: crypto.randomUUID(),
                };

                await handleAsyncOperation(
                    async () => {
                        await redis.rpush(
                            key,
                            JSON.stringify(messageWithTimestamp),
                        );
                        await redis.expire(key, LOGIN_CONFIG.MESSAGE_EXPIRY);
                    },
                    'Failed to send message',
                    ErrorCode.DATABASE_ERROR,
                );

                reply.code(200).send(
                    createSuccessResponse('sent', {
                        message: messageWithTimestamp,
                    }),
                );
            } catch (error) {
                const response = handleError(error, server);
                reply.code(500).send(response);
            }
        },
    );

    // Get messages endpoint
    server.get(
        '/get-messages',
        { preHandler: [server.authenticate] },
        async (request, reply) => {
            try {
                const username = (request as AuthenticatedRequest).username;
                const key = `${username}:messages`;

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

                reply.code(200).send(createSuccessResponse('ok', { messages }));
            } catch (error) {
                const response = handleError(error, server);
                reply.code(500).send(response);
            }
        },
    );

    // Clear messages endpoint
    server.delete(
        '/clear-messages',
        { preHandler: [server.authenticate] },
        async (request, reply) => {
            try {
                const username = (request as AuthenticatedRequest).username;
                const key = `${username}:messages`;

                const deletedCount = await handleAsyncOperation(
                    () => redis.del(key),
                    'Failed to clear messages',
                    ErrorCode.DATABASE_ERROR,
                );

                reply.code(200).send(
                    createSuccessResponse('cleared', {
                        count: deletedCount,
                    }),
                );
            } catch (error) {
                const response = handleError(error, server);
                reply.code(500).send(response);
            }
        },
    );
}
