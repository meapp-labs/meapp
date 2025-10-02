import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import z from 'zod';

import {
    ApiError,
    createUserNotFoundError,
    ErrorCode,
    handleError,
    NotFoundError,
} from '../lib/errors';
import { handleAsyncOperation } from '../lib/helpers';
import { usernameSchema } from '../validation/validation';

const otherSchema = z.object({
    other: usernameSchema,
});

export function otherRoutes(server: FastifyInstance) {
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
                const username = request.username;

                if (other === username) {
                    throw new ApiError(
                        ErrorCode.VALIDATION_ERROR,
                        'You cannot add yourself to your own list of others.',
                        400,
                    );
                }

                const otherExists = await handleAsyncOperation(
                    () => redis.exists(other),
                    'Failed to check other user existence',
                    ErrorCode.DATABASE_ERROR,
                );

                if (!otherExists) {
                    throw createUserNotFoundError(other);
                }

                const key = `${username}:others`;

                const others = await redis.lrange(key, 0, -1);
                if (others.includes(other)) {
                    throw new ApiError(
                        ErrorCode.DUPLICATE_ITEM,
                        'User is already in the list.',
                        409,
                    );
                }

                await handleAsyncOperation(
                    async () => {
                        await redis.rpush(key, other);
                    },
                    'Failed to add item',
                    ErrorCode.DATABASE_ERROR,
                );

                reply.code(200).send(other);
            } catch (error) {
                const response = handleError(error, server);
                const statusCode = response.statusCode || 500;
                reply.code(statusCode).send(response);
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
                const username = request.username;
                const key = `${username}:others`;

                const removedCount = await handleAsyncOperation(
                    () => redis.lrem(key, 0, other),
                    'Failed to remove item',
                    ErrorCode.DATABASE_ERROR,
                );

                if (removedCount === 0) {
                    throw new NotFoundError('Item', { item: other });
                }

                reply.code(200).send({
                    other,
                    count: removedCount,
                });
            } catch (error) {
                const response = handleError(error, server);
                const statusCode =
                    response.code === ErrorCode.ITEM_NOT_FOUND ? 404 : 500;
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
                const username = request.username;
                const key = `${username}:others`;

                const others = await handleAsyncOperation(
                    () => redis.lrange(key, 0, -1),
                    'Failed to retrieve items',
                    ErrorCode.DATABASE_ERROR,
                );

                reply.code(200).send(others);
            } catch (error) {
                const response = handleError(error, server);
                reply.code(500).send(response);
            }
        },
    );
}
