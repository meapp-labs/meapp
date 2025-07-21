
import { test, expect } from 'vitest';
import Fastify from 'fastify';
import healthRoute from './health';
import { name, version } from '../package.json';

test('GET /', async () => {
    const server = Fastify();
    server.register(healthRoute);

    const response = await server.inject({
        method: 'GET',
        url: '/',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('healthy');
    expect(body.data.name).toBe(name);
    expect(body.data.version).toBe(version);
    expect(body.data.uptime).toBeGreaterThan(0);
});
