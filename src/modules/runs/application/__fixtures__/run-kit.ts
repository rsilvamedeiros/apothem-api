import { AgentService } from '../../../agents/application/agent.service.js';
import { AuthorizationService } from '../../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../../authorization/application/tenant-context.js';
import type { OrganizationRole } from '../../../authorization/domain/role.js';
import type { GenerateRequest, GenerateResult, ModelGatewayPort } from '../../../models/application/model-gateway.port.js';
import type { ModelPolicy } from '../../../models/domain/model-policy.js';
import { BuiltInToolExecutor, type ToolExecutorPort } from '../../../tools/application/tool-executor.js';
import {
  FakeAgentDraftRepository,
  FakeAgentRepository,
  FakeAgentVersionRepository,
  FakeApprovalRepository,
  FakeAuditLog,
  FakeMembershipRepository,
  FakeNoteRepository,
  FakeRunRepository,
  FakeRunStepRepository,
} from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';
import { RunService } from '../run.service.js';
import { ApprovalService } from '../../../approvals/application/approval.service.js';
import { KnowledgeRetriever } from '../../../knowledge/application/knowledge-retriever.js';
import { KnowledgeService } from '../../../knowledge/application/knowledge.service.js';
import {
  FakeKnowledgeBaseRepository,
  FakeKnowledgeDocumentRepository,
  FakeKnowledgeSearch,
} from '../../../knowledge/application/__fixtures__/fake-knowledge-repositories.js';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const WORKSPACE = '22222222-2222-4222-8222-222222222222';

export function contextFor(role: OrganizationRole, principalSuffix: string = role, workspaceId: string | null = WORKSPACE): TenantContext {
  return {
    principal: { id: `principal-${principalSuffix}`, type: 'user', email: `${principalSuffix}@example.com`, name: principalSuffix },
    organizationId: ORG,
    organizationRole: role,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

export function textResult(text: string, overrides: Partial<GenerateResult> = {}): GenerateResult {
  return {
    provider: 'mock',
    model: 'mock-1',
    output: { type: 'text', text },
    usage: { inputTokens: 11, outputTokens: 7 },
    finishReason: 'stop',
    ...overrides,
  };
}

export function toolCallResult(toolName: string, args: unknown): GenerateResult {
  return {
    provider: 'mock',
    model: 'mock-1',
    output: { type: 'tool_call', toolName, arguments: args },
    usage: { inputTokens: 5, outputTokens: 2 },
    finishReason: 'tool_call',
  };
}

/** Gateway double: records every call and answers from a script (the last answer repeats). Each `respondWith` restarts the script. */
export class ScriptedGateway implements ModelGatewayPort {
  readonly calls: { policy: ModelPolicy; request: GenerateRequest }[] = [];
  private script: ((policy: ModelPolicy, request: GenerateRequest) => Promise<GenerateResult>)[] = [];

  private scriptStart = 0;

  /** Queue answers in order, starting from the next call. */
  respondWith(...answers: (GenerateResult | Error | ((request: GenerateRequest) => GenerateResult | Promise<GenerateResult>))[]): void {
    this.scriptStart = this.calls.length;
    this.script = answers.map((answer) => async (_policy, request) => {
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer(request) : answer;
    });
  }

  async generate(policy: ModelPolicy, request: GenerateRequest): Promise<GenerateResult> {
    this.calls.push({ policy, request });
    const index = Math.min(this.calls.length - 1 - this.scriptStart, this.script.length - 1);
    const step = this.script[index];
    return step ? step(policy, request) : textResult('hello');
  }
}

export interface RunKitOptions {
  executor?: ToolExecutorPort;
  now?: () => Date;
  approvalTtlMs?: number;
}

/** Wires the real application services to in-memory fakes. */
export function buildRunKit(options: RunKitOptions = {}) {
  const agents = new FakeAgentRepository();
  const drafts = new FakeAgentDraftRepository();
  const versions = new FakeAgentVersionRepository();
  const runs = new FakeRunRepository();
  const steps = new FakeRunStepRepository();
  const approvals = new FakeApprovalRepository();
  const notes = new FakeNoteRepository();
  const memberships = new FakeMembershipRepository();
  const knowledgeBases = new FakeKnowledgeBaseRepository();
  const knowledgeDocuments = new FakeKnowledgeDocumentRepository();
  const knowledgeSearch = new FakeKnowledgeSearch(knowledgeBases, knowledgeDocuments);
  const knowledgeRetriever = new KnowledgeRetriever(knowledgeSearch);
  const audit = new FakeAuditLog();
  const gateway = new ScriptedGateway();
  const authorization = new AuthorizationService();
  const clock = { current: new Date('2026-03-04T12:00:00.000Z') };
  const now = options.now ?? (() => new Date(clock.current));
  const executor = options.executor ?? new BuiltInToolExecutor(notes, now, knowledgeRetriever);
  const agentService = new AgentService(agents, drafts, versions, authorization, audit);
  const runService = new RunService(agents, versions, runs, steps, approvals, gateway, executor, authorization, audit, now, {
    ...(options.approvalTtlMs ? { approvalTtlMs: options.approvalTtlMs } : {}),
  });

  const approvalService = new ApprovalService(approvals, runService, agents, memberships, authorization, audit, now);
  const knowledgeService = new KnowledgeService(knowledgeBases, knowledgeDocuments, knowledgeRetriever, authorization, audit, now);

  /** Seeds an active organization membership so separation-of-duties rules can see who else could approve. */
  async function addMember(role: OrganizationRole, principalSuffix: string, status: 'active' | 'invited' | 'revoked' = 'active') {
    return memberships.create({ organizationId: ORG, principalId: `principal-${principalSuffix}`, role, status });
  }

  async function publishedAgent(
    config: {
      instructions?: string;
      modelPolicy?: object;
      guardrails?: object;
      toolBindings?: object[];
      knowledgeBindings?: object[];
      workspaceId?: string;
    } = {},
  ) {
    const ctx = contextFor('admin', 'kit-admin', config.workspaceId ?? WORKSPACE);
    const { agent } = await agentService.create(ctx, { name: 'Support', slug: `support-${crypto.randomUUID().slice(0, 8)}` });
    await agentService.updateDraft(ctx, agent.id, {
      instructions: config.instructions ?? 'You are a helpful support agent.',
      ...(config.modelPolicy ? { modelPolicy: config.modelPolicy } : {}),
      ...(config.guardrails ? { guardrails: config.guardrails } : {}),
      ...(config.toolBindings ? { toolBindings: config.toolBindings } : {}),
      ...(config.knowledgeBindings ? { knowledgeBindings: config.knowledgeBindings } : {}),
    });
    const version = await agentService.publish(ctx, agent.id);
    return { agent, version };
  }

  return {
    agents, drafts, versions, runs, steps, approvals, notes, memberships, audit, gateway, authorization,
    agentService, runService, approvalService, executor, clock, now, publishedAgent, addMember,
    knowledgeBases, knowledgeDocuments, knowledgeSearch, knowledgeService,
  };
}
