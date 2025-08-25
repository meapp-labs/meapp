import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { handleSyncOperation } from '../lib/helpers';
import { ErrorCode, createAuthError, handleError } from '../lib/errors';

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
