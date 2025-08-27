import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import { createAuthError, ErrorCode, handleError } from '../lib/errors';
import { handleSyncOperation } from '../lib/helpers';

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
                    return reply.code(error.statusCode).send(error);
                }

                request.username = username;
            } catch (error) {
                const response = handleError(error, server);
                return reply
                    .code(response.code === ErrorCode.SESSION_ERROR ? 500 : 401)
                    .send(response);
            }
        },
    );
});
