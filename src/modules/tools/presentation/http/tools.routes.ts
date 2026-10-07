import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { authenticateRequest } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import { TOOL_CATALOG } from '../../domain/tool-catalog.js';
import { TOOL_RISKS } from '../../domain/tool-policy.js';

const toolListResponse = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      risk: z.enum(TOOL_RISKS),
      /** What a binding may choose: irreversible tools cannot be set to run automatically. */
      allowedApprovalModes: z.array(z.enum(['auto', 'required'])),
    }),
  ),
});

export async function toolRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;

  // The catalog is static product information, not tenant data: it only needs an authenticated caller.
  app.get(
    '/v1/tools',
    {
      schema: {
        tags: ['tools'],
        response: { 200: toJsonSchema(toolListResponse), 401: errorResponseJsonSchema },
      },
    },
    async (request, reply) => {
      await authenticateRequest(request, services.authenticator);
      reply.status(200).send({
        tools: Object.values(TOOL_CATALOG).map((tool) => ({
          name: tool.name,
          description: tool.description,
          risk: tool.risk,
          allowedApprovalModes: tool.risk === 'irreversible' ? ['required'] : ['required', 'auto'],
        })),
      });
    },
  );
}
