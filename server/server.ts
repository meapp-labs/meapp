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
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);

        try {
            const { hostname, protocol } = new URL(origin);
            if (
                (hostname === 'localhost' || hostname === '127.0.0.1') &&
                (protocol === 'http:' || protocol === 'https:')
            ) {
                cb(null, true);
            } else {
                cb(new Error('Not allowed by CORS'), false);
            }
        } catch {
            cb(new Error('Invalid origin'), false);
        }
    },
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

server.register(authenticate);

server.register(healthRoutes);
server.register(authRoutes);
server.register(messageRoutes);
server.register(otherRoutes);

const start = async () => {
    try {
        await server.listen({ port: env.PORT });
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();
