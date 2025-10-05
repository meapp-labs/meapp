import 'fastify';
import '@fastify/secure-session';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }

  interface FastifyRequest {
    username: string;
  }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    username: string;
  }
}
