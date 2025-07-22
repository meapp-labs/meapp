import type { FastifyInstance } from 'fastify';
import { name, version } from '../package.json';
import { createSuccessResponse } from '../lib/responses';
import { handleError } from '../lib/errors';

export default async function (server: FastifyInstance) {
    // Health check endpoint
    server.get('/', async (_, reply) => {
        try {
            const data = { name, version, uptime: process.uptime() };
            reply.code(200).send(createSuccessResponse('healthy', data));
        } catch (error) {
            const response = handleError(error, server);
            reply.code(500).send(response);
        }
    });
}
