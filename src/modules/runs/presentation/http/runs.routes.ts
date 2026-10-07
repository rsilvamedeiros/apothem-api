import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../../../../infrastructure/http/app-services.js';
import { resolveTenantContext } from '../../../../infrastructure/http/tenant-context.middleware.js';
import { toJsonSchema, errorResponseJsonSchema } from '../../../../infrastructure/http/openapi.js';
import { MAX_RUN_INPUT_LENGTH, MAX_RUN_PAGE_SIZE } from '../../application/run.service.js';
import { RUN_STATUSES } from '../../domain/run-state.js';
import type { Run, RunStep } from '../../infrastructure/schema.js';

const workspaceParams = z.object({ organizationId: z.string().uuid(), workspaceId: z.string().uuid() });
const agentRunsParams = workspaceParams.extend({ agentId: z.string().uuid() });
const runParams = workspaceParams.extend({ runId: z.string().uuid() });

const startRunBody = z.object({
  input: z.string().min(1).max(MAX_RUN_INPUT_LENGTH),
  idempotencyKey: z.string().min(1).max(100).optional(),
});

const listRunsQuery = z.object({
  agentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_RUN_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

const nullableString = z.string().nullable();
const nullableInt = z.number().int().nullable();

const runResponse = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  agentVersionId: z.string().uuid(),
  requestedByPrincipalId: z.string().uuid(),
  status: z.enum(RUN_STATUSES),
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }).nullable(),
  errorCode: nullableString,
  errorMessage: nullableString,
  modelProvider: nullableString,
  model: nullableString,
  inputTokens: nullableInt,
  outputTokens: nullableInt,
  createdAt: z.string(),
  startedAt: nullableString,
  finishedAt: nullableString,
});

const stepResponse = z.object({
  id: z.string().uuid(),
  sequence: z.number().int(),
  type: z.string(),
  status: z.string(),
  modelProvider: nullableString,
  model: nullableString,
  inputTokens: nullableInt,
  outputTokens: nullableInt,
  finishReason: nullableString,
  durationMs: nullableInt,
  errorCode: nullableString,
  createdAt: z.string(),
});

const startRunResponse = z.object({ run: runResponse, replayed: z.boolean() });
const runDetailResponse = z.object({ run: runResponse, steps: z.array(stepResponse) });
const runPageResponse = z.object({ runs: z.array(runResponse), nextCursor: z.string().nullable() });

const errorResponses = {
  400: errorResponseJsonSchema,
  401: errorResponseJsonSchema,
  403: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
} as const;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function serializeRun(run: Run) {
  return {
    id: run.id,
    agentId: run.agentId,
    agentVersionId: run.agentVersionId,
    requestedByPrincipalId: run.requestedByPrincipalId,
    status: run.status,
    input: run.input,
    output: run.output,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    modelProvider: run.modelProvider,
    model: run.model,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
  };
}

function serializeStep(step: RunStep) {
  const { runId: _runId, ...rest } = step;
  return { ...rest, createdAt: step.createdAt.toISOString() };
}

export async function runRoutes(app: FastifyInstance, opts: { services: AppServices }): Promise<void> {
  const { services } = opts;
  const workspaceBase = '/v1/organizations/:organizationId/workspaces/:workspaceId';

  async function context(request: Parameters<typeof resolveTenantContext>[0], organizationId: string, workspaceId: string) {
    return resolveTenantContext(request, services.authenticator, services.tenantContextResolver, organizationId, workspaceId);
  }

  app.post(
    `${workspaceBase}/agents/:agentId/runs`,
    {
      schema: {
        tags: ['runs'],
        params: toJsonSchema(agentRunsParams),
        body: toJsonSchema(startRunBody),
        response: {
          200: toJsonSchema(startRunResponse),
          201: toJsonSchema(startRunResponse),
          ...errorResponses,
          409: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, agentId } = agentRunsParams.parse(request.params);
      const body = startRunBody.parse(request.body);
      const result = await services.runService.start(await context(request, organizationId, workspaceId), agentId, body);
      // 200 for an idempotent replay, 201 when a new run was created and executed.
      reply.status(result.replayed ? 200 : 201).send({ run: serializeRun(result.run), replayed: result.replayed });
    },
  );

  app.get(
    `${workspaceBase}/runs`,
    {
      schema: {
        tags: ['runs'],
        params: toJsonSchema(workspaceParams),
        querystring: toJsonSchema(listRunsQuery),
        response: { 200: toJsonSchema(runPageResponse), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId } = workspaceParams.parse(request.params);
      const query = listRunsQuery.parse(request.query);
      const page = await services.runService.list(await context(request, organizationId, workspaceId), query);
      reply.status(200).send({ runs: page.runs.map(serializeRun), nextCursor: page.nextCursor });
    },
  );

  app.get(
    `${workspaceBase}/runs/:runId`,
    {
      schema: {
        tags: ['runs'],
        params: toJsonSchema(runParams),
        response: { 200: toJsonSchema(runDetailResponse), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { organizationId, workspaceId, runId } = runParams.parse(request.params);
      const detail = await services.runService.get(await context(request, organizationId, workspaceId), runId);
      reply.status(200).send({ run: serializeRun(detail.run), steps: detail.steps.map(serializeStep) });
    },
  );
}
