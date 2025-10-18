import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { ErrorCode, createAuthError, handleError } from '@/lib/errors.ts';
import { handleSyncOperation } from '@/lib/helpers.ts';

export default fp(function (server: FastifyInstance) {
  server.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const sessionData = handleSyncOperation(
          () => ({
            username: request.session.get('username'),
            platform: request.session.get('platform'),
          }),
          'Failed to retrieve session data',
          ErrorCode.SESSION_ERROR,
        );

        if (!sessionData.username || !sessionData.platform) {
          const error = createAuthError('Authentication required');
          return reply.code(error.statusCode).send(error);
        }

        request.username = sessionData.username;
        request.platform = sessionData.platform;
      } catch (error) {
        const response = handleError(error, server);
        return reply
          .code(response.code === ErrorCode.SESSION_ERROR ? 500 : 401)
          .send(response);
      }
    },
  );
});
