import Fastify from 'fastify';
import authenticate from './plugins/authenticate';
import fastifyRedis from '@fastify/redis';
import fastifySecureSession from '@fastify/secure-session';
import fastifyCors from '@fastify/cors';
import { env } from './lib/config';

import healthRoute from './routes/health';
import authRoutes from './routes/auth';
import messageRoutes from './routes/messages';
import otherRoutes from './routes/others';

import {
    serializerCompiler,
    validatorCompiler,
} from 'fastify-type-provider-zod';

const server = Fastify({
    logger: true,
});

server.setValidatorCompiler(validatorCompiler);
server.setSerializerCompiler(serializerCompiler);

await server.register(fastifyRedis, {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
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

server.register(healthRoute);
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
