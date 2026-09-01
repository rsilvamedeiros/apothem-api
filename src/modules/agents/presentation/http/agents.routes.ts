import type { FastifyInstance } from 'fastify';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { resolveTenantContext } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import { z } from 'zod';
import {
  createAgentBodySchema,
  updateAgentDraftBodySchema,
  agentCollectionParamsSchema,
  agentItemParamsSchema,
  agentVersionItemParamsSchema,
  agentResponseSchema,
  agentWithDraftResponseSchema,
  agentVersionResponseSchema,
} from './schemas.js';

const errorResponses = {
  401: errorResponseJsonSchema,
  403: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
} as const;

export async function agentRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;
  const base = '/v1/organizations/:organizationId/workspaces/:workspaceId/agents';

  async function context(request: Parameters<typeof resolveTenantContext>[0], organizationId: string, workspaceId: string) {
    return resolveTenantContext(request, services.authenticator, services.tenantContextResolver, organizationId, workspaceId);
  }

  app.post(
    base,
    {
      schema: {
        tags: ['agents'],
        params: toJsonSchema(agentCollectionParamsSchema),
        body: toJsonSchema(createAgentBodySchema),
        response: { 201: toJsonSchema(agentWithDraftResponseSchema), ...errorResponses, 409: errorResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId } = agentCollectionParamsSchema.parse(request.params);
      const tenantContext = await context(request, organizationId, workspaceId);
      const input = createAgentBodySchema.parse(request.body);
      const result = await services.agentService.create(tenantContext, input);
      reply.status(201).send(result);
    },
  );

  app.get(
    base,
    {
      schema: {
        tags: ['agents'],
        params: toJsonSchema(agentCollectionParamsSchema),
        response: { 200: toJsonSchema(z.array(agentResponseSchema)), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId } = agentCollectionParamsSchema.parse(request.params);
      const tenantContext = await context(request, organizationId, workspaceId);
      const result = await services.agentService.list(tenantContext);
      reply.status(200).send(result);
    },
  );

  app.get(
    `${base}/:agentId`,
    {
      schema: {
        tags: ['agents'],
        params: toJsonSchema(agentItemParamsSchema),
        response: { 200: toJsonSchema(agentWithDraftResponseSchema), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, agentId } = agentItemParamsSchema.parse(request.params);
      const tenantContext = await context(request, organizationId, workspaceId);
      const result = await services.agentService.get(tenantContext, agentId);
      reply.status(200).send(result);
    },
  );

  app.patch(
    `${base}/:agentId/draft`,
    {
      schema: {
        tags: ['agents'],
        params: toJsonSchema(agentItemParamsSchema),
        body: toJsonSchema(updateAgentDraftBodySchema),
        response: { 200: toJsonSchema(agentWithDraftResponseSchema.shape.draft), ...errorResponses, 409: errorResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, agentId } = agentItemParamsSchema.parse(request.params);
      const tenantContext = await context(request, organizationId, workspaceId);
      const patch = updateAgentDraftBodySchema.parse(request.body);
      const result = await services.agentService.updateDraft(tenantContext, agentId, patch);
      reply.status(200).send(result);
    },
  );

  app.post(
    `${base}/:agentId/publish`,
    {
      schema: {
        tags: ['agents'],
        params: toJsonSchema(agentItemParamsSchema),
        response: {
          201: toJsonSchema(agentVersionResponseSchema),
          ...errorResponses,
          400: errorResponseJsonSchema,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, agentId } = agentItemParamsSchema.parse(request.params);
      const tenantContext = await context(request, organizationId, workspaceId);
      const result = await services.agentService.publish(tenantContext, agentId);
      reply.status(201).send(result);
    },
  );

  for (const status of ['disable', 'archive'] as const) {
    app.post(
      `${base}/:agentId/${status}`,
      {
        schema: {
          tags: ['agents'],
          params: toJsonSchema(agentItemParamsSchema),
          response: { 200: toJsonSchema(agentResponseSchema), ...errorResponses },
        },
      },
      async (request, reply) => {
        const { organizationId, workspaceId, agentId } = agentItemParamsSchema.parse(request.params);
        const tenantContext = await context(request, organizationId, workspaceId);
        const result = await services.agentService.setLifecycleStatus(
          tenantContext,
          agentId,
          status === 'disable' ? 'disabled' : 'archived',
        );
        reply.status(200).send(result);
      },
    );
  }

  app.get(
    `${base}/:agentId/versions`,
    {
      schema: {
        tags: ['agents'],
        params: toJsonSchema(agentItemParamsSchema),
        response: { 200: toJsonSchema(z.array(agentVersionResponseSchema)), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, agentId } = agentItemParamsSchema.parse(request.params);
      const tenantContext = await context(request, organizationId, workspaceId);
      const result = await services.agentService.listVersions(tenantContext, agentId);
      reply.status(200).send(result);
    },
  );

  app.get(
    `${base}/:agentId/versions/:versionId`,
    {
      schema: {
        tags: ['agents'],
        params: toJsonSchema(agentVersionItemParamsSchema),
        response: { 200: toJsonSchema(agentVersionResponseSchema), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, agentId, versionId } = agentVersionItemParamsSchema.parse(
        request.params,
      );
      const tenantContext = await context(request, organizationId, workspaceId);
      const result = await services.agentService.getVersion(tenantContext, agentId, versionId);
      reply.status(200).send(result);
    },
  );
}
