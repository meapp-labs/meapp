import Fastify from 'fastify';
import { expect, test } from 'vitest';

import { name, version } from '../package.json';
import { healthRoutes, type HealthType } from './health';

test('GET /', async () => {
    const server = Fastify();
    server.register(healthRoutes);

    const response = await server.inject({
        method: 'GET',
        url: '/',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as HealthType;

    expect(body.name).toBe(name);
    expect(body.version).toBe(version);
    expect(body.uptime).toBeGreaterThan(0);
});
