import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './env.js';

/**
 * Transport wiring only. Route handlers must delegate to module
 * application services — no business logic here.
 */
export function buildServer(_env: Env): FastifyInstance {
  const app = Fastify({
    logger: true,
    genReqId: () => crypto.randomUUID(),
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'apothem-api',
    timestamp: new Date().toISOString(),
  }));

  return app;
}
