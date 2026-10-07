import type { FastifyInstance } from 'fastify';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { resolveTenantContext } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import { auditPageResponseSchema, auditParamsSchema, auditQuerySchema } from './schemas.js';

export async function auditRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;

  app.get(
    '/v1/organizations/:organizationId/audit-events',
    {
      schema: {
        tags: ['audit'],
        params: toJsonSchema(auditParamsSchema),
        querystring: toJsonSchema(auditQuerySchema),
        response: {
          200: toJsonSchema(auditPageResponseSchema),
          400: errorResponseJsonSchema,
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = auditParamsSchema.parse(request.params);
      const query = auditQuerySchema.parse(request.query);
      const context = await resolveTenantContext(
        request,
        services.authenticator,
        services.tenantContextResolver,
        organizationId,
      );
      const page = await services.auditQueryService.list(context, query);
      reply.status(200).send({
        events: page.events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
        nextCursor: page.nextCursor,
      });
    },
  );
}
