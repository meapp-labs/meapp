import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { LOGIN_CONFIG } from '../lib/config';
import { handleAsyncOperation } from '../lib/helpers';
import { ErrorCode, handleError, NotFoundError } from '../lib/errors';
import { createSuccessResponse } from '../lib/responses';
import type { AuthenticatedRequest } from '../lib/types';
import z from 'zod';

export const otherSchema = z.object({
    other: z
        .string()
        .min(1, 'Other field cannot be empty')
        .max(1000, 'Other field too long'),
});

export default async function (server: FastifyInstance) {
    const { redis } = server;

    // Add other endpoint
    server.withTypeProvider<ZodTypeProvider>().post(
        '/add-other',
        {
            schema: { body: otherSchema },
            preHandler: [server.authenticate],
        },
        async (request, reply) => {
            try {
                const { other } = request.body;
                const username = (request as AuthenticatedRequest).username;
                const key = `${username}:others`;

                await handleAsyncOperation(
                    async () => {
                        await redis.rpush(key, other);
                        await redis.expire(key, LOGIN_CONFIG.MESSAGE_EXPIRY);
                    },
                    'Failed to add item',
                    ErrorCode.DATABASE_ERROR,
                );

                reply.code(200).send(createSuccessResponse('added', { other }));
            } catch (error) {
                const response = handleError(error, server);
                reply.code(500).send(response);
            }
        },
    );

    // Remove other endpoint
    server.withTypeProvider<ZodTypeProvider>().post(
        '/remove-other',
        {
            schema: { body: otherSchema },
            preHandler: [server.authenticate],
        },
        async (request, reply) => {
            try {
                const { other } = request.body;
                const username = (request as AuthenticatedRequest).username;
                const key = `${username}:others`;

                const removedCount = await handleAsyncOperation(
                    () => redis.lrem(key, 0, other),
                    'Failed to remove item',
                    ErrorCode.DATABASE_ERROR,
                );

                if (removedCount === 0) {
                    throw new NotFoundError('Item', { item: other });
                }

                reply
                    .code(200)
                    .send(
                        createSuccessResponse('removed', {
                            other,
                            count: removedCount,
                        }),
                    );
            } catch (error) {
                const response = handleError(error, server);
                const statusCode =
                    response.error?.code === ErrorCode.ITEM_NOT_FOUND
                        ? 404
                        : 500;
                reply.code(statusCode).send(response);
            }
        },
    );

    // Get others endpoint
    server.get(
        '/get-others',
        { preHandler: [server.authenticate] },
        async (request, reply) => {
            try {
                const username = (request as AuthenticatedRequest).username;
                const key = `${username}:others`;

                const others = await handleAsyncOperation(
                    () => redis.lrange(key, 0, -1),
                    'Failed to retrieve items',
                    ErrorCode.DATABASE_ERROR,
                );

                reply.code(200).send(createSuccessResponse('ok', { others }));
            } catch (error) {
                const response = handleError(error, server);
                reply.code(500).send(response);
            }
        },
    );
}
