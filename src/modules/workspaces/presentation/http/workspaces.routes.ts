import type { FastifyInstance } from 'fastify';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { resolveTenantContext } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import {
  createWorkspaceBodySchema,
  workspaceParamsSchema,
  workspaceItemParamsSchema,
  workspaceResponseSchema,
} from './schemas.js';
import { z } from 'zod';

export async function workspaceRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;

  app.post(
    '/v1/organizations/:organizationId/workspaces',
    {
      schema: {
        tags: ['workspaces'],
        params: toJsonSchema(workspaceParamsSchema),
        body: toJsonSchema(createWorkspaceBodySchema),
        response: {
          201: toJsonSchema(workspaceResponseSchema),
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = workspaceParamsSchema.parse(request.params);
      const context = await resolveTenantContext(
        request,
        services.authenticator,
        services.tenantContextResolver,
        organizationId,
      );
      const input = createWorkspaceBodySchema.parse(request.body);
      const workspace = await services.workspaceService.create(context, input);
      reply.status(201).send(workspace);
    },
  );

  app.get(
    '/v1/organizations/:organizationId/workspaces',
    {
      schema: {
        tags: ['workspaces'],
        params: toJsonSchema(workspaceParamsSchema),
        response: {
          200: toJsonSchema(z.array(workspaceResponseSchema)),
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = workspaceParamsSchema.parse(request.params);
      const context = await resolveTenantContext(
        request,
        services.authenticator,
        services.tenantContextResolver,
        organizationId,
      );
      const workspaces = await services.workspaceService.list(context);
      reply.status(200).send(workspaces);
    },
  );

  app.get(
    '/v1/organizations/:organizationId/workspaces/:workspaceId',
    {
      schema: {
        tags: ['workspaces'],
        params: toJsonSchema(workspaceItemParamsSchema),
        response: {
          200: toJsonSchema(workspaceResponseSchema),
          401: errorResponseJsonSchema,
          403: errorResponseJsonSchema,
          404: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId } = workspaceItemParamsSchema.parse(request.params);
      const context = await resolveTenantContext(
        request,
        services.authenticator,
        services.tenantContextResolver,
        organizationId,
        workspaceId,
      );
      const workspace = await services.workspaceService.get(context, workspaceId);
      reply.status(200).send(workspace);
    },
  );
}
