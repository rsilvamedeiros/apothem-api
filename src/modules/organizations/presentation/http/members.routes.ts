import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { resolveTenantContext } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import { ORGANIZATION_ROLES } from '../../../authorization/domain/role.js';
import { organizationParamsSchema } from './schemas.js';
import type { MemberView } from '../../application/member.service.js';

const roleSchema = z.enum(ORGANIZATION_ROLES);

const memberParamsSchema = organizationParamsSchema.extend({ membershipId: z.string().uuid() });

const addMemberBodySchema = z.object({
  email: z.string().trim().email().max(320),
  role: roleSchema,
});

const changeRoleBodySchema = z.object({ role: roleSchema });

const memberResponseSchema = z.object({
  membershipId: z.string().uuid(),
  principalId: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  status: z.enum(['active', 'invited', 'revoked']),
  createdAt: z.string(),
});

const errorResponses = {
  400: errorResponseJsonSchema,
  401: errorResponseJsonSchema,
  403: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
} as const;

function serialize(member: MemberView) {
  return { ...member, createdAt: member.createdAt.toISOString() };
}

export async function memberRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;
  const base = '/v1/organizations/:organizationId/members';

  async function context(request: Parameters<typeof resolveTenantContext>[0], organizationId: string) {
    return resolveTenantContext(request, services.authenticator, services.tenantContextResolver, organizationId);
  }

  app.get(
    base,
    {
      schema: {
        tags: ['members'],
        params: toJsonSchema(organizationParamsSchema),
        response: { 200: toJsonSchema(z.array(memberResponseSchema)), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId } = organizationParamsSchema.parse(request.params);
      const members = await services.memberService.list(await context(request, organizationId));
      reply.status(200).send(members.map(serialize));
    },
  );

  app.post(
    base,
    {
      schema: {
        tags: ['members'],
        params: toJsonSchema(organizationParamsSchema),
        body: toJsonSchema(addMemberBodySchema),
        response: { 201: toJsonSchema(memberResponseSchema), ...errorResponses, 409: errorResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const { organizationId } = organizationParamsSchema.parse(request.params);
      const body = addMemberBodySchema.parse(request.body);
      const member = await services.memberService.add(await context(request, organizationId), body);
      reply.status(201).send(serialize(member));
    },
  );

  app.patch(
    `${base}/:membershipId`,
    {
      schema: {
        tags: ['members'],
        params: toJsonSchema(memberParamsSchema),
        body: toJsonSchema(changeRoleBodySchema),
        response: { 200: toJsonSchema(memberResponseSchema), ...errorResponses, 409: errorResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const { organizationId, membershipId } = memberParamsSchema.parse(request.params);
      const { role } = changeRoleBodySchema.parse(request.body);
      const member = await services.memberService.changeRole(await context(request, organizationId), membershipId, role);
      reply.status(200).send(serialize(member));
    },
  );

  app.post(
    `${base}/:membershipId/revoke`,
    {
      schema: {
        tags: ['members'],
        params: toJsonSchema(memberParamsSchema),
        response: { 200: toJsonSchema(memberResponseSchema), ...errorResponses, 409: errorResponseJsonSchema },
      },
    },
    async (request, reply) => {
      const { organizationId, membershipId } = memberParamsSchema.parse(request.params);
      const member = await services.memberService.revoke(await context(request, organizationId), membershipId);
      reply.status(200).send(serialize(member));
    },
  );
}
