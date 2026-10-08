import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { resolveTenantContext } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import { WORKSPACE_TOOL_RULES } from '../../domain/tool-policy.js';
import type { ToolPolicy } from '../../infrastructure/schema.js';

const workspaceParams = z.object({ organizationId: z.string().uuid(), workspaceId: z.string().uuid() });
// Catalog names are snake_case; anything else is a malformed request, not an unknown tool.
const toolParams = workspaceParams.extend({ toolName: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) });
const setBody = z.object({ rule: z.enum(WORKSPACE_TOOL_RULES) });

const policyResponse = z.object({
  toolName: z.string(),
  rule: z.enum(WORKSPACE_TOOL_RULES),
  updatedByPrincipalId: z.string().uuid(),
  updatedAt: z.string(),
});
const setResponse = policyResponse.extend({ changed: z.boolean() });

const errorResponses = {
  400: errorResponseJsonSchema,
  401: errorResponseJsonSchema,
  403: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
} as const;

function serialize(policy: ToolPolicy) {
  return {
    toolName: policy.toolName,
    rule: policy.rule,
    updatedByPrincipalId: policy.updatedByPrincipalId,
    updatedAt: policy.updatedAt.toISOString(),
  };
}

export async function toolPolicyRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;
  const base = '/v1/organizations/:organizationId/workspaces/:workspaceId/tool-policies';

  async function context(request: Parameters<typeof resolveTenantContext>[0], organizationId: string, workspaceId: string) {
    return resolveTenantContext(request, services.authenticator, services.tenantContextResolver, organizationId, workspaceId);
  }

  app.get(
    base,
    {
      schema: {
        tags: ['tools'],
        params: toJsonSchema(workspaceParams),
        response: { 200: toJsonSchema(z.object({ policies: z.array(policyResponse) })), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId } = workspaceParams.parse(request.params);
      const policies = await services.toolPolicyService.list(await context(request, organizationId, workspaceId));
      reply.status(200).send({ policies: policies.map(serialize) });
    },
  );

  app.put(
    `${base}/:toolName`,
    {
      schema: {
        tags: ['tools'],
        params: toJsonSchema(toolParams),
        body: toJsonSchema(setBody),
        response: { 200: toJsonSchema(setResponse), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, toolName } = toolParams.parse(request.params);
      const { rule } = setBody.parse(request.body);
      const result = await services.toolPolicyService.set(await context(request, organizationId, workspaceId), toolName, rule);
      reply.status(200).send({ ...serialize(result.policy), changed: result.changed });
    },
  );

  app.delete(
    `${base}/:toolName`,
    {
      schema: {
        tags: ['tools'],
        params: toJsonSchema(toolParams),
        response: { 204: { type: 'null' }, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, toolName } = toolParams.parse(request.params);
      await services.toolPolicyService.remove(await context(request, organizationId, workspaceId), toolName);
      reply.status(204).send();
    },
  );
}
