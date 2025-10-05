import Fastify from 'fastify';
import {
    jsonSchemaTransform,
    serializerCompiler,
    validatorCompiler,
} from 'fastify-type-provider-zod';

import fastifyCors from '@fastify/cors';
import fastifyRedis from '@fastify/redis';
import fastifySecureSession from '@fastify/secure-session';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';

import { env } from './lib/config';
import authenticate from './plugins/authenticate';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { messageRoutes } from './routes/messages';
import { otherRoutes } from './routes/others';

const server = Fastify({
    logger: {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                ignore: 'pid,hostname',
            },
        },
    },
});

server.setValidatorCompiler(validatorCompiler);
server.setSerializerCompiler(serializerCompiler);

await server.register(fastifyRedis, {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
});

await server.register(swagger, {
    openapi: {
        info: {
            title: 'MeApp API',
            version: '1.0.0',
        },
    },
    transform: jsonSchemaTransform,
});

await server.register(swaggerUI, {
    routePrefix: '/docs',
});

await server.register(fastifyCors, {
    origin:
        process.env.NODE_ENV === 'production'
            ? env.EXTERNAL_IP
            : /localhost|127\.0\.0\.1/,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
});

await server.register(fastifySecureSession, {
    secret: env.SESSION_SECRET,
    salt: env.SESSION_SALT,
    sessionName: 'session',
    cookieName: 'session',
    cookie: {
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
});

server.register(authenticate, { prefix: '/api' });

server.register(healthRoutes, { prefix: '/api' });
server.register(authRoutes, { prefix: '/api' });
server.register(messageRoutes, { prefix: '/api' });
server.register(otherRoutes, { prefix: '/api' });

const start = async () => {
    try {
        await server.listen({ host: env.HOST, port: env.PORT });
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

await start();
