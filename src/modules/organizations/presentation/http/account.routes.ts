import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { authenticateRequest } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import { ORGANIZATION_ROLES } from '../../../authorization/domain/role.js';

const accountResponseSchema = z.object({
  principal: z.object({ id: z.string().uuid(), email: z.string(), name: z.string() }),
  organizations: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      slug: z.string(),
      role: z.enum(ORGANIZATION_ROLES),
    }),
  ),
});

export async function accountRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;

  app.get(
    '/v1/me',
    {
      schema: {
        tags: ['account'],
        response: { 200: toJsonSchema(accountResponseSchema), 401: errorResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const principal = await authenticateRequest(request, services.authenticator);
      reply.status(200).send(await services.accountService.overview(principal));
    },
  );
}
