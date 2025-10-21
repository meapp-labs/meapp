import '@fastify/secure-session';
import 'fastify';

import type { Platform } from '@/routes/auth.ts';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }

  interface FastifyRequest {
    username: string;
    platform: Platform;
  }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    username: string;
    platform: Platform;
  }
}
