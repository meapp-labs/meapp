import type { FastifyInstance } from 'fastify';
import { handleError } from '../lib/errors';
import { name, version } from '../package.json';

export type HealthType = {
    name: string;
    version: string;
    uptime: number;
};

export function healthRoutes(server: FastifyInstance) {
    // Health check endpoint
    server.get('/', async (_, reply) => {
        try {
            const data: HealthType = {
                name,
                version,
                uptime: process.uptime(),
            };
            reply.code(200).send(data);
        } catch (error) {
            const response = handleError(error, server);
            reply.code(500).send(response);
        }
    });
}
