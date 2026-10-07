import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { resolveTenantContext } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import { MAX_APPROVAL_PAGE_SIZE, MAX_DECISION_REASON_LENGTH } from '../../application/approval.service.js';
import { RUN_STATUSES } from '../../../runs/domain/run-state.js';
import type { Approval } from '../../infrastructure/schema.js';
import type { Run } from '../../../runs/infrastructure/schema.js';

const workspaceParams = z.object({ organizationId: z.string().uuid(), workspaceId: z.string().uuid() });
const approvalParams = workspaceParams.extend({ approvalId: z.string().uuid() });

const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;

const listQuery = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_APPROVAL_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

const decideBody = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(MAX_DECISION_REASON_LENGTH).optional(),
});

const nullableString = z.string().nullable();

export const approvalResponse = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  agentId: z.string().uuid(),
  stepSequence: z.number().int(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  requestedByPrincipalId: z.string().uuid(),
  status: z.enum(APPROVAL_STATUSES),
  expiresAt: z.string(),
  decidedByPrincipalId: nullableString,
  decisionReason: nullableString,
  selfApproved: z.boolean(),
  decidedAt: nullableString,
  createdAt: z.string(),
});

const runSummary = z.object({
  id: z.string().uuid(),
  status: z.enum(RUN_STATUSES),
  output: z.object({ text: z.string() }).nullable(),
  errorCode: nullableString,
  errorMessage: nullableString,
});

const approvalPage = z.object({ approvals: z.array(approvalResponse), nextCursor: nullableString });
const decisionResponse = z.object({ approval: approvalResponse, run: runSummary });

const errorResponses = {
  400: errorResponseJsonSchema,
  401: errorResponseJsonSchema,
  403: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
  409: errorResponseJsonSchema,
} as const;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function serializeApproval(approval: Approval) {
  return {
    id: approval.id,
    runId: approval.runId,
    agentId: approval.agentId,
    stepSequence: approval.stepSequence,
    toolName: approval.toolName,
    arguments: approval.arguments,
    requestedByPrincipalId: approval.requestedByPrincipalId,
    status: approval.status,
    expiresAt: approval.expiresAt.toISOString(),
    decidedByPrincipalId: approval.decidedByPrincipalId,
    decisionReason: approval.decisionReason,
    selfApproved: approval.selfApproved,
    decidedAt: iso(approval.decidedAt),
    createdAt: approval.createdAt.toISOString(),
  };
}

function serializeRunSummary(run: Run) {
  return { id: run.id, status: run.status, output: run.output, errorCode: run.errorCode, errorMessage: run.errorMessage };
}

export async function approvalRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;
  const base = '/v1/organizations/:organizationId/workspaces/:workspaceId/approvals';

  async function context(request: Parameters<typeof resolveTenantContext>[0], organizationId: string, workspaceId: string) {
    return resolveTenantContext(request, services.authenticator, services.tenantContextResolver, organizationId, workspaceId);
  }

  app.get(
    base,
    {
      schema: {
        tags: ['approvals'],
        params: toJsonSchema(workspaceParams),
        querystring: toJsonSchema(listQuery),
        response: { 200: toJsonSchema(approvalPage), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId } = workspaceParams.parse(request.params);
      const query = listQuery.parse(request.query);
      const page = await services.approvalService.list(await context(request, organizationId, workspaceId), query);
      reply.status(200).send({ approvals: page.approvals.map(serializeApproval), nextCursor: page.nextCursor });
    },
  );

  app.post(
    `${base}/:approvalId/decision`,
    {
      schema: {
        tags: ['approvals'],
        params: toJsonSchema(approvalParams),
        body: toJsonSchema(decideBody),
        response: { 200: toJsonSchema(decisionResponse), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, approvalId } = approvalParams.parse(request.params);
      const body = decideBody.parse(request.body);
      const result = await services.approvalService.decide(await context(request, organizationId, workspaceId), approvalId, body);
      reply.status(200).send({ approval: serializeApproval(result.approval), run: serializeRunSummary(result.run) });
    },
  );
}
