import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import { sql } from 'drizzle-orm';
import type { Env } from './env.js';
import type { Database } from '../database/client.js';
import { buildAppServices, type AppServices } from './app-services.js';
import { errorHandler } from './error-handler.js';
import { requestValidatorCompiler } from './validation.js';
import { organizationRoutes } from '../../modules/organizations/presentation/http/organizations.routes.js';
import { accountRoutes } from '../../modules/organizations/presentation/http/account.routes.js';
import { memberRoutes } from '../../modules/organizations/presentation/http/members.routes.js';
import { workspaceRoutes } from '../../modules/workspaces/presentation/http/workspaces.routes.js';
import { agentRoutes } from '../../modules/agents/presentation/http/agents.routes.js';
import { approvalRoutes } from '../../modules/approvals/presentation/http/approvals.routes.js';
import { knowledgeRoutes } from '../../modules/knowledge/presentation/http/knowledge.routes.js';
import { toolRoutes } from '../../modules/tools/presentation/http/tools.routes.js';
import { toolPolicyRoutes } from '../../modules/tools/presentation/http/tool-policies.routes.js';
import { runRoutes } from '../../modules/runs/presentation/http/runs.routes.js';
import { auditRoutes } from '../../modules/audit/presentation/http/audit.routes.js';

/**
 * Transport wiring only. Route handlers must delegate to module
 * application services — no business logic here.
 *
 * `services` is injectable so tests can exercise real route/middleware
 * wiring against fake application services without a database — see
 * organizations.routes.test.ts. Production boot (main/index.ts) always lets
 * it default to the Drizzle-backed services built from `db`.
 */
export async function buildServer(env: Env, db: Database, services?: AppServices): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      enabled: env.NODE_ENV !== 'test',
      // Correlation id (request.id) is included by Fastify's default request
      // log serializer; redact anything that could carry a credential — see
      // observability-logging-tracing.md ("minimizing sensitive content").
      redact: {
        paths: ['req.headers.authorization', 'req.headers["x-principal-id"]'],
        censor: '[redacted]',
      },
    },
    genReqId: () => crypto.randomUUID(),
  });

  // Echoed back so a client/log aggregator can correlate its own trace with
  // the server-side request log and any error response's requestId field.
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  app.setErrorHandler(errorHandler);
  app.setValidatorCompiler(requestValidatorCompiler);

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'APOTHEM API',
        description: 'Identity, organizations, workspaces, agents, knowledge, connect, flow, approvals, audit.',
        version: '0.1.0',
      },
      servers: [{ url: 'https://api.apothemai.com.br', description: 'Production' }],
    },
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'apothem-api',
    timestamp: new Date().toISOString(),
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ready' };
    } catch (error) {
      app.log.error({ err: error }, 'Readiness check failed: database unreachable');
      reply.status(503);
      return { status: 'not_ready' };
    }
  });

  app.get('/v1/openapi.json', async () => app.swagger());

  const resolvedServices = services ?? buildAppServices(db, env);
  await app.register(organizationRoutes, { services: resolvedServices });
  await app.register(accountRoutes, { services: resolvedServices });
  await app.register(memberRoutes, { services: resolvedServices });
  await app.register(workspaceRoutes, { services: resolvedServices });
  await app.register(agentRoutes, { services: resolvedServices });
  await app.register(toolRoutes, { services: resolvedServices });
  await app.register(toolPolicyRoutes, { services: resolvedServices });
  await app.register(runRoutes, { services: resolvedServices });
  await app.register(approvalRoutes, { services: resolvedServices });
  await app.register(knowledgeRoutes, { services: resolvedServices });
  await app.register(auditRoutes, { services: resolvedServices });

  if (env.AUTH_MODE === 'dev') {
    // loadEnv refuses this combination in production; the warning is for local runs.
    app.log.warn('AUTH_MODE=dev: the x-principal-id header is trusted without verification. Never expose this.');
  }

  return app;
}
