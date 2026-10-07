import type { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { AuditPort } from '../../audit/application/audit.port.js';
import type { AgentPort } from '../../agents/application/agent.port.js';
import type { AgentVersionPort } from '../../agents/application/agent-version.port.js';
import { parseGuardrails, parseModelPolicy } from '../../agents/domain/agent-config.js';
import type { AgentVersion } from '../../agents/infrastructure/schema.js';
import { ModelPolicyNoRouteError, ModelProviderError } from '../../models/domain/model-error.js';
import type { ModelGatewayPort } from '../../models/application/model-gateway.port.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../common/keyset-cursor.js';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import type { RunErrorCode } from '../domain/run-state.js';
import type { Run, RunStep } from '../infrastructure/schema.js';
import type { RunPort, RunStepPort } from './run.port.js';

export const MAX_RUN_INPUT_LENGTH = 20_000;
export const DEFAULT_RUN_PAGE_SIZE = 25;
export const MAX_RUN_PAGE_SIZE = 100;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,100}$/;

export interface StartRunInput {
  input: string;
  idempotencyKey?: string | undefined;
}

export interface StartRunResult {
  run: Run;
  /** True when an earlier run with the same idempotency key was returned instead of starting a new one. */
  replayed: boolean;
}

export interface RunQuery {
  agentId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface RunPage {
  runs: Run[];
  nextCursor: string | null;
}

/** Fixed, user-safe text per code. Provider messages, policies and tool names never reach a run record. */
const ERROR_MESSAGES: Record<RunErrorCode, string> = {
  RUN_CONFIG_INVALID: 'The agent version has an invalid configuration.',
  MODEL_POLICY_NO_ROUTE: 'No approved model satisfies this agent’s model policy.',
  MODEL_PROVIDER_UNAVAILABLE: 'The model provider is unavailable. Try again shortly.',
  MODEL_REQUEST_REJECTED: 'The model provider rejected the request.',
  RUN_BUDGET_EXCEEDED: 'The run exceeded its time budget.',
  TOOL_NOT_BOUND: 'The model asked for a tool this agent does not have.',
  RUN_INTERNAL_ERROR: 'The run failed unexpectedly.',
};

class RunTimeoutError extends Error {}

function classify(error: unknown): RunErrorCode {
  if (error instanceof RunTimeoutError) return 'RUN_BUDGET_EXCEEDED';
  if (error instanceof ModelPolicyNoRouteError) return 'MODEL_POLICY_NO_ROUTE';
  if (error instanceof ModelProviderError) {
    return error.errorClass === 'invalid_request' || error.errorClass === 'safety'
      ? 'MODEL_REQUEST_REJECTED'
      : 'MODEL_PROVIDER_UNAVAILABLE';
  }
  return 'RUN_INTERNAL_ERROR';
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_RUN_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_RUN_PAGE_SIZE);
}

function requireWorkspaceScope(context: TenantContext): string {
  if (!context.workspaceId) {
    throw new ForbiddenError('Runs require a resolved workspace scope');
  }
  return context.workspaceId;
}

/**
 * Executes published agent versions and keeps the durable record of every
 * attempt. The model request is assembled here from the immutable version,
 * never from client input; the only client-controlled content is the task
 * text. Execution is synchronous for now but persisted step by step, so moving
 * it to a worker later changes where `execute` runs, not the record.
 */
export class RunService {
  constructor(
    private readonly agents: AgentPort,
    private readonly versions: AgentVersionPort,
    private readonly runs: RunPort,
    private readonly steps: RunStepPort,
    private readonly gateway: ModelGatewayPort,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditPort,
  ) {}

  async start(context: TenantContext, agentId: string, input: StartRunInput): Promise<StartRunResult> {
    this.authorization.assert(context, 'agent.run');
    const workspaceId = requireWorkspaceScope(context);

    const text = input.input.trim();
    if (text.length === 0 || text.length > MAX_RUN_INPUT_LENGTH) {
      throw new InvalidInputError(`Run input must be between 1 and ${MAX_RUN_INPUT_LENGTH} characters`);
    }
    if (input.idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
      throw new InvalidInputError('Idempotency key must be 1-100 characters of letters, digits, "_", ".", ":" or "-"');
    }

    const agent = await this.agents.findById(workspaceId, agentId);
    if (!agent) {
      throw new NotFoundError(`Agent ${agentId} not found`);
    }

    if (input.idempotencyKey !== undefined) {
      const existing = await this.runs.findByIdempotencyKey(workspaceId, input.idempotencyKey);
      if (existing) {
        // A key identifies one request: reusing it for another agent or by someone else is a conflict,
        // never a way to read somebody else's run.
        if (existing.agentId !== agentId || existing.requestedByPrincipalId !== context.principal.id) {
          throw new ConflictError('This idempotency key was already used for a different request');
        }
        return { run: existing, replayed: true };
      }
    }

    if (agent.status !== 'active' || !agent.activeVersionId) {
      throw new ConflictError(`Agent is not runnable: it is ${agent.status === 'active' ? 'not published' : agent.status}`);
    }
    const version = await this.versions.findById(agentId, agent.activeVersionId);
    if (!version) {
      throw new ConflictError('Agent is not runnable: its active version is missing');
    }

    let created: Run;
    try {
      created = await this.runs.create({
        organizationId: context.organizationId,
        workspaceId,
        agentId,
        agentVersionId: version.id,
        requestedByPrincipalId: context.principal.id,
        status: 'queued',
        idempotencyKey: input.idempotencyKey ?? null,
        input: { text },
      });
    } catch (error) {
      // Two identical requests can pass the lookup above together; the unique
      // index lets exactly one create the run and the other replays it.
      const winner = input.idempotencyKey ? await this.runs.findByIdempotencyKey(workspaceId, input.idempotencyKey) : undefined;
      if (winner && winner.agentId === agentId && winner.requestedByPrincipalId === context.principal.id) {
        return { run: winner, replayed: true };
      }
      throw error;
    }
    await this.recordAudit(context, 'run.started', created, version);

    const finished = await this.execute(context, created, version, text);
    await this.recordAudit(context, finished.status === 'completed' ? 'run.completed' : 'run.failed', finished, version);
    return { run: finished, replayed: false };
  }

  async get(context: TenantContext, runId: string): Promise<{ run: Run; steps: RunStep[] }> {
    this.authorization.assert(context, 'run.read');
    const workspaceId = requireWorkspaceScope(context);
    const run = await this.runs.findById(workspaceId, runId);
    // Operators see only their own runs; another's run is indistinguishable from a missing one.
    if (!run || !this.canSee(context, run)) {
      throw new NotFoundError(`Run ${runId} not found`);
    }
    return { run, steps: await this.steps.listByRun(run.id) };
  }

  async list(context: TenantContext, query: RunQuery): Promise<RunPage> {
    this.authorization.assert(context, 'run.read');
    const workspaceId = requireWorkspaceScope(context);

    const limit = clampLimit(query.limit);
    const after = query.cursor === undefined ? undefined : decodeKeysetCursor(query.cursor);

    const rows = await this.runs.list(
      workspaceId,
      {
        agentId: query.agentId,
        requestedByPrincipalId: context.organizationRole === 'operator' ? context.principal.id : undefined,
      },
      { limit: limit + 1, after },
    );

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      runs: page,
      nextCursor: rows.length > limit && last ? encodeKeysetCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  private canSee(context: TenantContext, run: Run): boolean {
    return context.organizationRole !== 'operator' || run.requestedByPrincipalId === context.principal.id;
  }

  private async execute(context: TenantContext, run: Run, version: AgentVersion, text: string): Promise<Run> {
    const workspaceId = run.workspaceId;
    const running = await this.runs.advance(workspaceId, run.id, 'queued', 'running', { startedAt: new Date() });
    if (!running) return run;

    const policy = parseModelPolicy(version.modelPolicy);
    const limits = parseGuardrails(version.guardrails);
    if (!policy.ok || !limits.ok) {
      return this.fail(running, 'RUN_CONFIG_INVALID', 0);
    }

    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.gateway.generate(policy.value, {
          systemInstructions: version.instructions,
          messages: [{ role: 'user', content: text }],
          maxOutputTokens: limits.value.maxOutputTokens,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new RunTimeoutError()), limits.value.timeoutMs);
        }),
      ]);
      const durationMs = Date.now() - startedAt;

      if (result.output.type === 'tool_call') {
        // No tool is bound yet, and the model's request is never executed or stored verbatim.
        return this.fail(running, 'TOOL_NOT_BOUND', durationMs, result);
      }
      if (result.finishReason === 'content_filter') {
        return this.fail(running, 'MODEL_REQUEST_REJECTED', durationMs, result);
      }

      await this.steps.create({
        runId: running.id,
        sequence: 1,
        type: 'model_call',
        status: 'completed',
        modelProvider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        finishReason: result.finishReason,
        durationMs,
      });
      const completed = await this.runs.advance(workspaceId, running.id, 'running', 'completed', {
        finishedAt: new Date(),
        output: { text: result.output.text },
        modelProvider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      return completed ?? (await this.current(workspaceId, running));
    } catch (error) {
      return this.fail(running, classify(error), Date.now() - startedAt);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async fail(
    run: Run,
    code: RunErrorCode,
    durationMs: number,
    result?: { provider: string; model: string; usage: { inputTokens: number; outputTokens: number }; finishReason: string },
  ): Promise<Run> {
    // The step is best effort: a storage problem here must not hide the failure itself.
    await this.steps
      .create({
        runId: run.id,
        sequence: 1,
        type: 'model_call',
        status: 'failed',
        modelProvider: result?.provider ?? null,
        model: result?.model ?? null,
        inputTokens: result?.usage.inputTokens ?? null,
        outputTokens: result?.usage.outputTokens ?? null,
        finishReason: result?.finishReason ?? null,
        durationMs,
        errorCode: code,
      })
      .catch(() => undefined);

    const failed = await this.runs.advance(run.workspaceId, run.id, 'running', 'failed', {
      finishedAt: new Date(),
      errorCode: code,
      errorMessage: ERROR_MESSAGES[code],
      ...(result ? { modelProvider: result.provider, model: result.model } : {}),
    });
    return failed ?? (await this.current(run.workspaceId, run));
  }

  /** If another writer already finished the run (e.g. the timeout fired first), report what is stored. */
  private async current(workspaceId: string, run: Run): Promise<Run> {
    return (await this.runs.findById(workspaceId, run.id)) ?? run;
  }

  private async recordAudit(context: TenantContext, action: string, run: Run, version: AgentVersion): Promise<void> {
    await this.audit.record({
      organizationId: context.organizationId,
      workspaceId: run.workspaceId,
      actorPrincipalId: context.principal.id,
      action,
      targetType: 'run',
      targetId: run.id,
      // Ids and outcome only: the task text and the model output are never copied into the audit trail.
      metadata: {
        agentId: run.agentId,
        agentVersionId: version.id,
        status: run.status,
        ...(run.errorCode ? { errorCode: run.errorCode } : {}),
      },
    });
  }
}
