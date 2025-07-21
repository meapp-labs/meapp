import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { handleSyncOperation } from '../lib/helpers';
import { ErrorCode, createAuthError, handleError } from '../lib/errors';
import { createErrorResponse } from '../lib/responses';
import type { AuthenticatedRequest } from '../lib/types';

export default fp(async function (server: FastifyInstance) {
    server.decorate(
        'authenticate',
        async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const username = handleSyncOperation(
                    () => request.session.get('username'),
                    'Failed to retrieve session data',
                    ErrorCode.SESSION_ERROR,
                );

                if (!username) {
                    const error = createAuthError('Authentication required');
                    return reply
                        .code(error.statusCode)
                        .send(createErrorResponse(error));
                }

                (request as AuthenticatedRequest).username = username;
            } catch (error) {
                const response = handleError(error, server);
                return reply
                    .code(
                        response.error?.code === ErrorCode.SESSION_ERROR
                            ? 500
                            : 401,
                    )
                    .send(response);
            }
        },
    );
});
