import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunService, MAX_RUN_INPUT_LENGTH } from './run.service.js';
import { AuthorizationService } from '../../authorization/application/authorization.service.js';
import { AgentService } from '../../agents/application/agent.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { OrganizationRole } from '../../authorization/domain/role.js';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import { ModelPolicyNoRouteError, ModelProviderError, type ModelErrorClass } from '../../models/domain/model-error.js';
import type { GenerateRequest, GenerateResult, ModelGatewayPort } from '../../models/application/model-gateway.port.js';
import type { ModelPolicy } from '../../models/domain/model-policy.js';
import { ModelRouter } from '../../models/application/model-router.js';
import { MockModelAdapter } from '../../../infrastructure/ai/mock-model.adapter.js';
import {
  FakeAgentDraftRepository,
  FakeAgentRepository,
  FakeAgentVersionRepository,
  FakeAuditLog,
  FakeRunRepository,
  FakeRunStepRepository,
} from '../../../infrastructure/http/__fixtures__/fake-repositories.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const OTHER_WORKSPACE = '33333333-3333-4333-8333-333333333333';

const contextFor = (role: OrganizationRole, workspaceId: string | null = WORKSPACE, principalSuffix: string = role): TenantContext => ({
  principal: { id: `principal-${principalSuffix}`, type: 'user', email: `${principalSuffix}@example.com`, name: principalSuffix },
  organizationId: ORG,
  organizationRole: role,
  ...(workspaceId ? { workspaceId } : {}),
});

/** Gateway double that records every call and can be scripted. */
class ScriptedGateway implements ModelGatewayPort {
  readonly calls: { policy: ModelPolicy; request: GenerateRequest }[] = [];
  behavior: (policy: ModelPolicy, request: GenerateRequest) => Promise<GenerateResult> = async () => ok('hello');

  async generate(policy: ModelPolicy, request: GenerateRequest): Promise<GenerateResult> {
    this.calls.push({ policy, request });
    return this.behavior(policy, request);
  }
}

function ok(text: string, overrides: Partial<GenerateResult> = {}): GenerateResult {
  return {
    provider: 'mock',
    model: 'mock-1',
    output: { type: 'text', text },
    usage: { inputTokens: 11, outputTokens: 7 },
    finishReason: 'stop',
    ...overrides,
  };
}

describe('RunService', () => {
  let agents: FakeAgentRepository;
  let drafts: FakeAgentDraftRepository;
  let versions: FakeAgentVersionRepository;
  let runs: FakeRunRepository;
  let steps: FakeRunStepRepository;
  let audit: FakeAuditLog;
  let gateway: ScriptedGateway;
  let agentService: AgentService;
  let service: RunService;

  const admin = contextFor('admin');
  const builder = contextFor('builder');

  beforeEach(() => {
    agents = new FakeAgentRepository();
    drafts = new FakeAgentDraftRepository();
    versions = new FakeAgentVersionRepository();
    runs = new FakeRunRepository();
    steps = new FakeRunStepRepository();
    audit = new FakeAuditLog();
    gateway = new ScriptedGateway();
    const authorization = new AuthorizationService();
    agentService = new AgentService(agents, drafts, versions, authorization, audit);
    service = new RunService(agents, versions, runs, steps, gateway, authorization, audit);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function publishedAgent(config: { instructions?: string; modelPolicy?: object; guardrails?: object; workspaceId?: string } = {}) {
    const ctx = contextFor('admin', config.workspaceId ?? WORKSPACE);
    const { agent } = await agentService.create(ctx, { name: 'Support', slug: `support-${crypto.randomUUID().slice(0, 8)}` });
    await agentService.updateDraft(ctx, agent.id, {
      instructions: config.instructions ?? 'You are a helpful support agent.',
      ...(config.modelPolicy ? { modelPolicy: config.modelPolicy } : {}),
      ...(config.guardrails ? { guardrails: config.guardrails } : {}),
    });
    const version = await agentService.publish(ctx, agent.id);
    return { agent, version };
  }

  describe('starting a run', () => {
    it('runs the pinned version through the gateway and records a completed run', async () => {
      const { agent, version } = await publishedAgent({ modelPolicy: { allowedProviders: ['mock'] } });
      gateway.behavior = async () => ok('Hi there');

      const { run, replayed } = await service.start(builder, agent.id, { input: 'Hello' });

      expect(replayed).toBe(false);
      expect(run).toMatchObject({
        status: 'completed',
        agentId: agent.id,
        agentVersionId: version.id,
        organizationId: ORG,
        workspaceId: WORKSPACE,
        requestedByPrincipalId: builder.principal.id,
        input: { text: 'Hello' },
        output: { text: 'Hi there' },
        modelProvider: 'mock',
        model: 'mock-1',
        inputTokens: 11,
        outputTokens: 7,
        errorCode: null,
      });
      expect(run.startedAt).toBeInstanceOf(Date);
      expect(run.finishedAt).toBeInstanceOf(Date);
    });

    it('builds the model request server-side from the immutable version, never from the client', async () => {
      const { agent } = await publishedAgent({
        instructions: 'Answer only about billing.',
        modelPolicy: { allowedProviders: ['mock'], qualityTier: 'standard' },
        guardrails: { maxOutputTokens: 321 },
      });
      await service.start(builder, agent.id, { input: 'Why was I charged?' });

      expect(gateway.calls).toHaveLength(1);
      expect(gateway.calls[0]!.policy).toEqual({ allowedProviders: ['mock'], qualityTier: 'standard' });
      expect(gateway.calls[0]!.request).toMatchObject({
        systemInstructions: 'Answer only about billing.',
        messages: [{ role: 'user', content: 'Why was I charged?' }],
        maxOutputTokens: 321,
      });
      expect(gateway.calls[0]!.request.tools).toBeUndefined();
    });

    it('keeps the run pinned to the version that was active when it started', async () => {
      const { agent, version } = await publishedAgent();
      const { run } = await service.start(builder, agent.id, { input: 'one' });
      await agentService.updateDraft(admin, agent.id, { instructions: 'New behavior.' });
      const second = await agentService.publish(admin, agent.id);

      expect(second.id).not.toBe(version.id);
      expect((await service.get(builder, run.id)).run.agentVersionId).toBe(version.id);
      const next = await service.start(builder, agent.id, { input: 'two' });
      expect(next.run.agentVersionId).toBe(second.id);
    });

    it('persists a model step with normalized metadata only', async () => {
      const { agent } = await publishedAgent();
      gateway.behavior = async () => ok('x', { finishReason: 'length' });
      const { run } = await service.start(builder, agent.id, { input: 'hi' });

      const { steps: recorded } = await service.get(builder, run.id);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        sequence: 1,
        type: 'model_call',
        status: 'completed',
        modelProvider: 'mock',
        model: 'mock-1',
        inputTokens: 11,
        outputTokens: 7,
        finishReason: 'length',
        errorCode: null,
      });
      expect(recorded[0]!.durationMs).toBeGreaterThanOrEqual(0);
      expect(Object.keys(recorded[0]!)).not.toContain('reasoning');
    });

    it('audits the start and the outcome without recording the input text', async () => {
      const { agent, version } = await publishedAgent();
      const { run } = await service.start(builder, agent.id, { input: 'my secret account number 12345' });

      const events = audit.events.filter((e) => e.action.startsWith('run.'));
      expect(events.map((e) => e.action)).toEqual(['run.started', 'run.completed']);
      expect(events[1]).toMatchObject({
        organizationId: ORG,
        workspaceId: WORKSPACE,
        actorPrincipalId: builder.principal.id,
        targetType: 'run',
        targetId: run.id,
        metadata: { agentId: agent.id, agentVersionId: version.id, status: 'completed' },
      });
      expect(JSON.stringify(audit.events)).not.toContain('12345');
    });
  });

  describe('preconditions and scope', () => {
    it.each(['owner', 'admin', 'builder', 'operator'] as const)('lets %s start a run', async (role) => {
      const { agent } = await publishedAgent();
      await expect(service.start(contextFor(role), agent.id, { input: 'hi' })).resolves.toBeDefined();
    });

    it('denies an auditor without touching the gateway or the store', async () => {
      const { agent } = await publishedAgent();
      await expect(service.start(contextFor('auditor'), agent.id, { input: 'hi' })).rejects.toThrow(ForbiddenError);
      expect(gateway.calls).toHaveLength(0);
      expect(runs.rows).toHaveLength(0);
    });

    it('refuses to run without a workspace scope', async () => {
      await expect(service.start(contextFor('owner', null), crypto.randomUUID(), { input: 'hi' })).rejects.toThrow(ForbiddenError);
    });

    it('does not find an agent of another workspace', async () => {
      const { agent } = await publishedAgent({ workspaceId: OTHER_WORKSPACE });
      await expect(service.start(builder, agent.id, { input: 'hi' })).rejects.toThrow(NotFoundError);
      expect(gateway.calls).toHaveLength(0);
    });

    it.each([
      ['a draft that was never published', async () => (await agentService.create(admin, { name: 'D', slug: 'draft-only' })).agent.id],
      [
        'a disabled agent',
        async () => {
          const { agent } = await publishedAgent();
          await agentService.setLifecycleStatus(admin, agent.id, 'disabled');
          return agent.id;
        },
      ],
      [
        'an archived agent',
        async () => {
          const { agent } = await publishedAgent();
          await agentService.setLifecycleStatus(admin, agent.id, 'archived');
          return agent.id;
        },
      ],
    ])('refuses %s', async (_label, setup) => {
      const agentId = await setup();
      await expect(service.start(builder, agentId, { input: 'hi' })).rejects.toThrow(ConflictError);
      expect(gateway.calls).toHaveLength(0);
      expect(runs.rows).toHaveLength(0);
    });

    it.each([
      ['empty', ''],
      ['blank', '   \n\t'],
      ['too long', 'x'.repeat(MAX_RUN_INPUT_LENGTH + 1)],
    ])('rejects %s input before creating anything', async (_label, input) => {
      const { agent } = await publishedAgent();
      await expect(service.start(builder, agent.id, { input })).rejects.toThrow(InvalidInputError);
      expect(runs.rows).toHaveLength(0);
    });

    it('accepts input at the limit and trims surrounding whitespace', async () => {
      const { agent } = await publishedAgent();
      const { run } = await service.start(builder, agent.id, { input: `  ${'x'.repeat(MAX_RUN_INPUT_LENGTH)}  ` });
      expect((run.input as { text: string }).text).toHaveLength(MAX_RUN_INPUT_LENGTH);
    });
  });

  describe('idempotency', () => {
    it('returns the existing run for the same key without running the model twice', async () => {
      const { agent } = await publishedAgent();
      const first = await service.start(builder, agent.id, { input: 'hi', idempotencyKey: 'key-1' });
      const second = await service.start(builder, agent.id, { input: 'hi', idempotencyKey: 'key-1' });

      expect(second.replayed).toBe(true);
      expect(second.run.id).toBe(first.run.id);
      expect(gateway.calls).toHaveLength(1);
      expect(runs.rows).toHaveLength(1);
    });

    it('refuses to reuse a key for a different agent', async () => {
      const a = await publishedAgent();
      const b = await publishedAgent();
      await service.start(builder, a.agent.id, { input: 'hi', idempotencyKey: 'shared' });
      await expect(service.start(builder, b.agent.id, { input: 'hi', idempotencyKey: 'shared' })).rejects.toThrow(ConflictError);
    });

    it('scopes keys per workspace', async () => {
      const a = await publishedAgent();
      const other = await publishedAgent({ workspaceId: OTHER_WORKSPACE });
      await service.start(builder, a.agent.id, { input: 'hi', idempotencyKey: 'same' });
      await expect(
        service.start(contextFor('builder', OTHER_WORKSPACE), other.agent.id, { input: 'hi', idempotencyKey: 'same' }),
      ).resolves.toMatchObject({ replayed: false });
    });

    it('does not let another principal read a run through a replayed key', async () => {
      const { agent } = await publishedAgent();
      await service.start(contextFor('operator', WORKSPACE, 'op-a'), agent.id, { input: 'secret', idempotencyKey: 'k' });
      await expect(
        service.start(contextFor('operator', WORKSPACE, 'op-b'), agent.id, { input: 'hi', idempotencyKey: 'k' }),
      ).rejects.toThrow(ConflictError);
    });

    it.each(['', ' ', 'has space', 'a'.repeat(101), 'bad/char', 'emoji🙂'])('rejects the key %j', async (idempotencyKey) => {
      const { agent } = await publishedAgent();
      await expect(service.start(builder, agent.id, { input: 'hi', idempotencyKey })).rejects.toThrow(InvalidInputError);
    });
  });

  describe('failures are recorded as failed runs, with stable public codes', () => {
    async function failing(behavior: ScriptedGateway['behavior'], config: Parameters<typeof publishedAgent>[0] = {}) {
      const { agent } = await publishedAgent(config);
      gateway.behavior = behavior;
      const { run } = await service.start(builder, agent.id, { input: 'hi' });
      return { run, agent };
    }

    it('maps "no route for the policy" to MODEL_POLICY_NO_ROUTE', async () => {
      const { run } = await failing(async () => {
        throw new ModelPolicyNoRouteError('No model route satisfies policy: {"allowedProviders":["secret-vendor"]}');
      });
      expect(run).toMatchObject({ status: 'failed', errorCode: 'MODEL_POLICY_NO_ROUTE', output: null });
    });

    it.each<[ModelErrorClass, string]>([
      ['transient', 'MODEL_PROVIDER_UNAVAILABLE'],
      ['rate_limit', 'MODEL_PROVIDER_UNAVAILABLE'],
      ['unavailable', 'MODEL_PROVIDER_UNAVAILABLE'],
      ['auth', 'MODEL_PROVIDER_UNAVAILABLE'],
      ['invalid_request', 'MODEL_REQUEST_REJECTED'],
      ['safety', 'MODEL_REQUEST_REJECTED'],
    ])('maps provider error class %s to %s', async (errorClass, code) => {
      const { run } = await failing(async () => {
        throw new ModelProviderError('boom', errorClass, 'anthropic');
      });
      expect(run).toMatchObject({ status: 'failed', errorCode: code });
    });

    it('never stores provider error text, API keys or policy details in the run, steps or audit', async () => {
      const { run } = await failing(async () => {
        throw new ModelProviderError('401 invalid x-api-key sk-ant-SECRET123', 'auth', 'anthropic');
      });
      const stored = JSON.stringify([runs.rows, steps.rows, audit.events]);
      expect(stored).not.toContain('SECRET123');
      expect(stored).not.toContain('x-api-key');
      expect(run.errorMessage).toBe('The model provider is unavailable. Try again shortly.');
    });

    it('treats an unexpected error as RUN_INTERNAL_ERROR without leaking it', async () => {
      const { run } = await failing(async () => {
        throw new Error('database password is hunter2');
      });
      expect(run).toMatchObject({ status: 'failed', errorCode: 'RUN_INTERNAL_ERROR' });
      expect(JSON.stringify(run)).not.toContain('hunter2');
    });

    it('fails a model tool request with TOOL_NOT_BOUND because no tools are bound yet', async () => {
      const { run } = await failing(async () => ok('', { output: { type: 'tool_call', toolName: 'drop_database', arguments: {} }, finishReason: 'tool_call' }));
      expect(run).toMatchObject({ status: 'failed', errorCode: 'TOOL_NOT_BOUND' });
      expect(JSON.stringify(run)).not.toContain('drop_database');
    });

    it('fails a provider content filter as MODEL_REQUEST_REJECTED', async () => {
      const { run } = await failing(async () => ok('', { finishReason: 'content_filter' }));
      expect(run).toMatchObject({ status: 'failed', errorCode: 'MODEL_REQUEST_REJECTED' });
    });

    it('fails a version with an invalid stored configuration without calling the model', async () => {
      const { agent, version } = await publishedAgent();
      // Simulates a legacy or tampered snapshot that bypassed publish validation.
      // The fake returns its stored row, so this edits the "persisted" snapshot.
      (await versions.findById(agent.id, version.id))!.guardrails = { timeoutMs: 1 };

      const { run } = await service.start(builder, agent.id, { input: 'hi' });
      expect(run).toMatchObject({ status: 'failed', errorCode: 'RUN_CONFIG_INVALID' });
      expect(gateway.calls).toHaveLength(0);
    });

    it('records a failed step and a run.failed audit event with the code', async () => {
      const { run } = await failing(async () => {
        throw new ModelProviderError('x', 'rate_limit', 'p');
      });
      const { steps: recorded } = await service.get(builder, run.id);
      expect(recorded[0]).toMatchObject({ status: 'failed', errorCode: 'MODEL_PROVIDER_UNAVAILABLE' });
      expect(audit.events.at(-1)).toMatchObject({
        action: 'run.failed',
        metadata: { status: 'failed', errorCode: 'MODEL_PROVIDER_UNAVAILABLE' },
      });
    });

    it('does not retry a failed model call on its own', async () => {
      const { agent } = await publishedAgent();
      gateway.behavior = async () => {
        throw new ModelProviderError('x', 'transient', 'p');
      };
      await service.start(builder, agent.id, { input: 'hi' });
      expect(gateway.calls).toHaveLength(1);
    });
  });

  describe('time budget', () => {
    it('fails with RUN_BUDGET_EXCEEDED when the model takes too long and ignores the late answer', async () => {
      vi.useFakeTimers();
      const { agent } = await publishedAgent({ guardrails: { timeoutMs: 2000 } });
      let finish: (value: GenerateResult) => void = () => undefined;
      gateway.behavior = () => new Promise<GenerateResult>((resolve) => { finish = resolve; });

      const pending = service.start(builder, agent.id, { input: 'hi' });
      await vi.advanceTimersByTimeAsync(2001);
      const { run } = await pending;
      expect(run).toMatchObject({ status: 'failed', errorCode: 'RUN_BUDGET_EXCEEDED' });

      finish(ok('too late'));
      await vi.advanceTimersByTimeAsync(10);
      const stored = await service.get(builder, run.id);
      expect(stored.run).toMatchObject({ status: 'failed', output: null });
    });
  });

  describe('state integrity', () => {
    it('never overwrites a run that already reached a terminal state', async () => {
      const { agent } = await publishedAgent();
      const { run } = await service.start(builder, agent.id, { input: 'hi' });
      const again = await runs.advance(WORKSPACE, run.id, 'running', 'failed', { errorCode: 'RUN_INTERNAL_ERROR' });
      expect(again).toBeUndefined();
      expect((await service.get(builder, run.id)).run.status).toBe('completed');
    });
  });

  describe('reading runs', () => {
    it('returns a run with its steps to roles that can read runs', async () => {
      const { agent } = await publishedAgent();
      const { run } = await service.start(builder, agent.id, { input: 'hi' });
      for (const role of ['owner', 'admin', 'builder', 'auditor'] as const) {
        await expect(service.get(contextFor(role), run.id)).resolves.toMatchObject({ run: { id: run.id } });
      }
    });

    it('does not find a run of another workspace', async () => {
      const { agent } = await publishedAgent();
      const { run } = await service.start(builder, agent.id, { input: 'hi' });
      await expect(service.get(contextFor('owner', OTHER_WORKSPACE), run.id)).rejects.toThrow(NotFoundError);
    });

    it('lets an operator see only the runs they started', async () => {
      const { agent } = await publishedAgent();
      const mine = contextFor('operator', WORKSPACE, 'op-mine');
      const theirs = contextFor('operator', WORKSPACE, 'op-theirs');
      const own = await service.start(mine, agent.id, { input: 'mine' });
      const other = await service.start(theirs, agent.id, { input: 'theirs' });

      expect((await service.list(mine, {})).runs.map((r) => r.id)).toEqual([own.run.id]);
      await expect(service.get(mine, other.run.id)).rejects.toThrow(NotFoundError);
      expect((await service.list(contextFor('builder'), {})).runs).toHaveLength(2);
    });

    it('lists newest first with cursor pagination, filters and workspace scope', async () => {
      const a = await publishedAgent();
      const b = await publishedAgent();
      const other = await publishedAgent({ workspaceId: OTHER_WORKSPACE });
      const ids: string[] = [];
      for (const [agent, n] of [[a.agent, 1], [b.agent, 2], [a.agent, 3], [a.agent, 4], [b.agent, 5]] as const) {
        ids.push((await service.start(builder, agent.id, { input: `run ${n}` })).run.id);
      }
      await service.start(contextFor('builder', OTHER_WORKSPACE), other.agent.id, { input: 'elsewhere' });

      const first = await service.list(builder, { limit: 2 });
      expect(first.runs.map((r) => r.id)).toEqual([ids[4], ids[3]]);
      const second = await service.list(builder, { limit: 2, cursor: first.nextCursor! });
      expect(second.runs.map((r) => r.id)).toEqual([ids[2], ids[1]]);
      const third = await service.list(builder, { limit: 2, cursor: second.nextCursor! });
      expect(third.runs.map((r) => r.id)).toEqual([ids[0]]);
      expect(third.nextCursor).toBeNull();

      const onlyA = await service.list(builder, { agentId: a.agent.id });
      expect(onlyA.runs.map((r) => r.id)).toEqual([ids[3], ids[2], ids[0]]);
    });

    it('rejects a malformed cursor and clamps the limit', async () => {
      await expect(service.list(builder, { cursor: 'garbage' })).rejects.toThrow(InvalidInputError);
      await publishedAgent();
      await service.list(builder, { limit: 100_000 });
      await service.list(builder, { limit: 0 });
    });
  });

  describe('with the real model router and mock adapter', () => {
    beforeEach(() => {
      const router = new ModelRouter(new Map([['mock', new MockModelAdapter()]]), [
        {
          provider: 'mock',
          model: 'mock-1',
          qualityTier: 'standard',
          capabilities: new MockModelAdapter().capabilities,
          pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
        },
      ]);
      service = new RunService(agents, versions, runs, steps, router, new AuthorizationService(), audit);
    });

    it('completes deterministically with the mock provider', async () => {
      const { agent } = await publishedAgent({ modelPolicy: { allowedProviders: ['mock'] } });
      const { run } = await service.start(builder, agent.id, { input: 'ping' });
      expect(run).toMatchObject({ status: 'completed', output: { text: 'Mock response to: ping' }, modelProvider: 'mock' });
    });

    it('fails with MODEL_POLICY_NO_ROUTE when the policy asks for a provider that is not configured', async () => {
      const { agent } = await publishedAgent({ modelPolicy: { allowedProviders: ['anthropic'] } });
      const { run } = await service.start(builder, agent.id, { input: 'ping' });
      expect(run).toMatchObject({ status: 'failed', errorCode: 'MODEL_POLICY_NO_ROUTE' });
    });

    it('honors the cost budget through the gateway (free mock fits a zero budget)', async () => {
      const { agent } = await publishedAgent({ modelPolicy: { allowedProviders: ['mock'], maxCostPerRunUsd: 0 } });
      expect((await service.start(builder, agent.id, { input: 'ping' })).run.status).toBe('completed');
    });
  });
});
