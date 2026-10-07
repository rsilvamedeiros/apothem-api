import { createHash } from 'node:crypto';
import type { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { AuditPort } from '../../audit/application/audit.port.js';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import { canonicalJson } from './canonical-json.js';
import { parseGuardrails, parseModelPolicy } from '../domain/agent-config.js';
import { parseToolBindings } from '../../tools/domain/tool-bindings.js';
import type { AgentPort } from './agent.port.js';
import type { AgentDraftPatch, AgentDraftPort } from './agent-draft.port.js';
import type { AgentVersionPort } from './agent-version.port.js';
import type { Agent, AgentDraft, AgentVersion } from '../infrastructure/schema.js';

export interface CreateAgentInput {
  name: string;
  slug: string;
  description?: string | undefined;
}

export interface AgentWithDraft {
  agent: Agent;
  draft: AgentDraft;
}

function requireWorkspaceScope(context: TenantContext): string {
  if (!context.workspaceId) {
    // Should be unreachable — every agents route resolves a workspace-scoped
    // TenantContext — but agents are workspace-owned resources, so refuse
    // rather than silently operate at organization scope.
    throw new ForbiddenError('Agents require a resolved workspace scope');
  }
  return context.workspaceId;
}

function snapshotChecksum(snapshot: {
  instructions: string;
  modelPolicy: unknown;
  knowledgeBindings: unknown;
  toolBindings: unknown;
  memoryPolicy: unknown;
  guardrails: unknown;
}): string {
  return createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

export class AgentService {
  constructor(
    private readonly agents: AgentPort,
    private readonly drafts: AgentDraftPort,
    private readonly versions: AgentVersionPort,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditPort,
  ) {}

  async create(context: TenantContext, input: CreateAgentInput): Promise<AgentWithDraft> {
    this.authorization.assert(context, 'agent.draft.write');
    const workspaceId = requireWorkspaceScope(context);

    const existing = await this.agents.findBySlug(workspaceId, input.slug);
    if (existing) {
      throw new ConflictError(`Agent slug "${input.slug}" is already in use in this workspace`);
    }

    const agent = await this.agents.create({
      organizationId: context.organizationId,
      workspaceId,
      name: input.name,
      slug: input.slug,
      description: input.description,
    });
    const draft = await this.drafts.create({ agentId: agent.id });

    await this.audit.record({
      organizationId: context.organizationId,
      workspaceId,
      actorPrincipalId: context.principal.id,
      action: 'agent.created',
      targetType: 'agent',
      targetId: agent.id,
      metadata: { slug: agent.slug },
    });

    return { agent, draft };
  }

  async get(context: TenantContext, agentId: string): Promise<AgentWithDraft> {
    this.authorization.assert(context, 'agent.read');
    const workspaceId = requireWorkspaceScope(context);

    const agent = await this.agents.findById(workspaceId, agentId);
    if (!agent) {
      throw new NotFoundError(`Agent ${agentId} not found`);
    }
    const draft = await this.drafts.findByAgentId(agent.id);
    if (!draft) {
      throw new NotFoundError(`Draft for agent ${agentId} not found`);
    }
    return { agent, draft };
  }

  async list(context: TenantContext): Promise<Agent[]> {
    this.authorization.assert(context, 'agent.read');
    return this.agents.listByWorkspace(requireWorkspaceScope(context));
  }

  async updateDraft(context: TenantContext, agentId: string, patch: AgentDraftPatch): Promise<AgentDraft> {
    this.authorization.assert(context, 'agent.draft.write');
    const workspaceId = requireWorkspaceScope(context);

    const agent = await this.agents.findById(workspaceId, agentId);
    if (!agent) {
      throw new NotFoundError(`Agent ${agentId} not found`);
    }
    if (agent.status === 'archived') {
      throw new ConflictError('Cannot edit the draft of an archived agent');
    }

    const draft = await this.drafts.update(agentId, patch);

    await this.audit.record({
      organizationId: context.organizationId,
      workspaceId,
      actorPrincipalId: context.principal.id,
      action: 'agent.draft_updated',
      targetType: 'agent',
      targetId: agentId,
    });

    return draft;
  }

  async publish(context: TenantContext, agentId: string): Promise<AgentVersion> {
    this.authorization.assert(context, 'agent.publish');
    const workspaceId = requireWorkspaceScope(context);

    const agent = await this.agents.findById(workspaceId, agentId);
    if (!agent) {
      throw new NotFoundError(`Agent ${agentId} not found`);
    }
    if (agent.status === 'archived') {
      throw new ConflictError('Cannot publish an archived agent');
    }

    const draft = await this.drafts.findByAgentId(agentId);
    if (!draft) {
      throw new NotFoundError(`Draft for agent ${agentId} not found`);
    }
    if (draft.instructions.trim().length === 0) {
      throw new InvalidInputError('Cannot publish an agent draft with empty instructions');
    }

    // Fail at publish time, not at the first run: an immutable version must be runnable.
    const modelPolicy = parseModelPolicy(draft.modelPolicy);
    if (!modelPolicy.ok) {
      throw new InvalidInputError(`Invalid model policy: ${modelPolicy.issues.join('; ')}`);
    }
    const guardrails = parseGuardrails(draft.guardrails);
    if (!guardrails.ok) {
      throw new InvalidInputError(`Invalid guardrails: ${guardrails.issues.join('; ')}`);
    }
    const toolBindings = parseToolBindings(draft.toolBindings);
    if (!toolBindings.ok) {
      throw new InvalidInputError(`Invalid tool bindings: ${toolBindings.issues.join('; ')}`);
    }

    const snapshot = {
      instructions: draft.instructions,
      modelPolicy: draft.modelPolicy,
      knowledgeBindings: draft.knowledgeBindings,
      toolBindings: draft.toolBindings,
      memoryPolicy: draft.memoryPolicy,
      guardrails: draft.guardrails,
    };

    // Read-then-insert of the next version number is not fully race-safe
    // under concurrent publishes of the same agent; the (agentId,
    // versionNumber) unique index still prevents two versions from ever
    // sharing a number — a concurrent publish fails closed (safe to retry)
    // rather than corrupting version history.
    const nextVersionNumber = (await this.versions.findLatestVersionNumber(agentId)) + 1;

    const version = await this.versions.create({
      agentId,
      versionNumber: nextVersionNumber,
      ...snapshot,
      checksum: snapshotChecksum(snapshot),
      publishedByPrincipalId: context.principal.id,
    });

    await this.agents.updateLifecycle(agentId, {
      status: agent.status === 'draft' ? 'active' : agent.status,
      activeVersionId: version.id,
    });

    await this.audit.record({
      organizationId: context.organizationId,
      workspaceId,
      actorPrincipalId: context.principal.id,
      action: 'agent.version_published',
      targetType: 'agent_version',
      targetId: version.id,
      metadata: { agentId, versionNumber: version.versionNumber, checksum: version.checksum },
    });

    return version;
  }

  async setLifecycleStatus(
    context: TenantContext,
    agentId: string,
    status: Extract<Agent['status'], 'disabled' | 'archived'>,
  ): Promise<Agent> {
    this.authorization.assert(context, 'agent.publish');
    const workspaceId = requireWorkspaceScope(context);

    const agent = await this.agents.findById(workspaceId, agentId);
    if (!agent) {
      throw new NotFoundError(`Agent ${agentId} not found`);
    }

    if (agent.status === 'archived') {
      throw new ConflictError('Archived agents are terminal and cannot change status');
    }

    const updated = await this.agents.updateLifecycle(agentId, { status });

    await this.audit.record({
      organizationId: context.organizationId,
      workspaceId,
      actorPrincipalId: context.principal.id,
      action: status === 'disabled' ? 'agent.disabled' : 'agent.archived',
      targetType: 'agent',
      targetId: agentId,
    });

    return updated;
  }

  async listVersions(context: TenantContext, agentId: string): Promise<AgentVersion[]> {
    this.authorization.assert(context, 'agent.read');
    const workspaceId = requireWorkspaceScope(context);
    const agent = await this.agents.findById(workspaceId, agentId);
    if (!agent) {
      throw new NotFoundError(`Agent ${agentId} not found`);
    }
    return this.versions.listByAgent(agentId);
  }

  async getVersion(context: TenantContext, agentId: string, versionId: string): Promise<AgentVersion> {
    this.authorization.assert(context, 'agent.read');
    const workspaceId = requireWorkspaceScope(context);
    const agent = await this.agents.findById(workspaceId, agentId);
    if (!agent) {
      throw new NotFoundError(`Agent ${agentId} not found`);
    }
    const version = await this.versions.findById(agentId, versionId);
    if (!version) {
      throw new NotFoundError(`Version ${versionId} not found for agent ${agentId}`);
    }
    return version;
  }
}
