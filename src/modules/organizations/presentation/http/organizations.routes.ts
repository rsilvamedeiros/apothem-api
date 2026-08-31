import type { FastifyInstance } from 'fastify';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { authenticateRequest, resolveTenantContext } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import {
  createOrganizationBodySchema,
  organizationParamsSchema,
  organizationResponseSchema,
} from './schemas.js';

/**
 * Delivery layer only — auth/tenant resolution, validation and persistence
 * decisions live in the middleware and application services this calls.
 */
export async function organizationRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;

  app.post(
    '/v1/organizations',
    {
      schema: {
        tags: ['organizations'],
        body: toJsonSchema(createOrganizationBodySchema),
        response: { 201: toJsonSchema(organizationResponseSchema), 401: errorResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const principal = await authenticateRequest(request, services.authenticator);
      const input = createOrganizationBodySchema.parse(request.body);
      const organization = await services.organizationService.create(principal, input);
      reply.status(201).send(organization);
    },
  );

  app.get(
    '/v1/organizations/:organizationId',
    {
      schema: {
        tags: ['organizations'],
        params: toJsonSchema(organizationParamsSchema),
        response: {
          200: toJsonSchema(organizationResponseSchema),
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = organizationParamsSchema.parse(request.params);
      const context = await resolveTenantContext(
        request,
        services.authenticator,
        services.tenantContextResolver,
        organizationId,
      );
      const organization = await services.organizationService.get(context);
      reply.status(200).send(organization);
    },
  );
}
