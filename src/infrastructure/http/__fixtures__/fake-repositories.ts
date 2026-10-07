import type { AuditEvent, AuditPort } from '../../../modules/audit/application/audit.port.js';
import type {
  AuditEventFilter,
  AuditPageRequest,
  AuditReaderPort,
  StoredAuditEvent,
} from '../../../modules/audit/application/audit-reader.port.js';
import type { Membership, NewMembership } from '../../../modules/organizations/infrastructure/schema.js';
import type { Organization, NewOrganization } from '../../../modules/organizations/infrastructure/schema.js';
import type { Principal, NewPrincipal } from '../../../modules/identity/infrastructure/schema.js';
import type { Workspace, NewWorkspace } from '../../../modules/workspaces/infrastructure/schema.js';
import type {
  WorkspaceMembership,
  NewWorkspaceMembership,
} from '../../../modules/workspaces/infrastructure/schema.js';
import type { PrincipalPort } from '../../../modules/identity/application/principal.port.js';
import type { OrganizationPort } from '../../../modules/organizations/application/organization.port.js';
import type { MembershipPort } from '../../../modules/organizations/application/membership.port.js';
import type { WorkspacePort } from '../../../modules/workspaces/application/workspace.port.js';
import type { WorkspaceMembershipPort } from '../../../modules/workspaces/application/workspace-membership.port.js';
import type { Agent, NewAgent, AgentDraft, NewAgentDraft, AgentVersion, NewAgentVersion } from '../../../modules/agents/infrastructure/schema.js';
import type { AgentPort } from '../../../modules/agents/application/agent.port.js';
import type { AgentDraftPatch, AgentDraftPort } from '../../../modules/agents/application/agent-draft.port.js';
import type { AgentVersionPort } from '../../../modules/agents/application/agent-version.port.js';

/**
 * In-memory stand-ins for the Drizzle repositories, structurally compatible
 * with the concrete repository classes (same public method shapes) so they
 * can be passed straight into the real application services under test ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
 * see organizations-workspaces.routes.test.ts. Not a mocking framework: just
 * enough persistence to exercise real business/authorization logic in tests
 * without a database.
 */
// Route params validate as UUIDs (see organizations/workspaces presentation
// schemas), so fake ids must be real UUIDs too, not readable prefixes.
function nextId(_prefix: string): string {
  return crypto.randomUUID();
}

export class FakePrincipalRepository implements PrincipalPort {
  private readonly rows: Principal[] = [];

  async findById(id: string): Promise<Principal | undefined> {
    return this.rows.find((row) => row.id === id);
  }

  async findByEmail(email: string): Promise<Principal | undefined> {
    return this.rows.find((row) => row.email === email);
  }

  async create(input: NewPrincipal): Promise<Principal> {
    const row: Principal = {
      id: input.id ?? nextId('principal'),
      type: input.type ?? 'user',
      email: input.email,
      name: input.name,
      status: input.status ?? 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
}

export class FakeOrganizationRepository implements OrganizationPort {
  private readonly rows: Organization[] = [];

  async findById(id: string): Promise<Organization | undefined> {
    return this.rows.find((row) => row.id === id);
  }

  async findBySlug(slug: string): Promise<Organization | undefined> {
    return this.rows.find((row) => row.slug === slug);
  }

  async create(input: NewOrganization): Promise<Organization> {
    const row: Organization = {
      id: input.id ?? nextId('org'),
      name: input.name,
      slug: input.slug,
      status: input.status ?? 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
}

export class FakeMembershipRepository implements MembershipPort {
  private readonly rows: Membership[] = [];

  async findByPrincipalInOrganization(
    organizationId: string,
    principalId: string,
  ): Promise<Membership | undefined> {
    return this.rows.find((row) => row.organizationId === organizationId && row.principalId === principalId);
  }

  async listByOrganization(organizationId: string): Promise<Membership[]> {
    return this.rows.filter((row) => row.organizationId === organizationId);
  }

  async listByPrincipal(principalId: string): Promise<Membership[]> {
    return this.rows.filter((row) => row.principalId === principalId);
  }

  async create(input: NewMembership): Promise<Membership> {
    const row: Membership = {
      id: input.id ?? nextId('membership'),
      organizationId: input.organizationId,
      principalId: input.principalId,
      role: input.role ?? 'operator',
      status: input.status ?? 'active',
      settings: input.settings ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
}

export class FakeWorkspaceRepository implements WorkspacePort {
  private readonly rows: Workspace[] = [];

  async findById(organizationId: string, workspaceId: string): Promise<Workspace | undefined> {
    return this.rows.find((row) => row.organizationId === organizationId && row.id === workspaceId);
  }

  async findBySlug(organizationId: string, slug: string): Promise<Workspace | undefined> {
    return this.rows.find((row) => row.organizationId === organizationId && row.slug === slug);
  }

  async listByOrganization(organizationId: string): Promise<Workspace[]> {
    return this.rows.filter((row) => row.organizationId === organizationId);
  }

  async create(input: NewWorkspace): Promise<Workspace> {
    const row: Workspace = {
      id: input.id ?? nextId('workspace'),
      organizationId: input.organizationId,
      name: input.name,
      slug: input.slug,
      status: input.status ?? 'active',
      settings: input.settings ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
}

export class FakeWorkspaceMembershipRepository implements WorkspaceMembershipPort {
  private readonly rows: WorkspaceMembership[] = [];

  async findByMembershipInWorkspace(
    workspaceId: string,
    membershipId: string,
  ): Promise<WorkspaceMembership | undefined> {
    return this.rows.find((row) => row.workspaceId === workspaceId && row.membershipId === membershipId);
  }

  async listByWorkspace(workspaceId: string): Promise<WorkspaceMembership[]> {
    return this.rows.filter((row) => row.workspaceId === workspaceId);
  }

  async create(input: NewWorkspaceMembership): Promise<WorkspaceMembership> {
    const row: WorkspaceMembership = {
      id: input.id ?? nextId('workspace-membership'),
      workspaceId: input.workspaceId,
      membershipId: input.membershipId,
      role: input.role ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
}

export class FakeAgentRepository implements AgentPort {
  private readonly rows: Agent[] = [];

  async findById(workspaceId: string, agentId: string): Promise<Agent | undefined> {
    return this.rows.find((row) => row.workspaceId === workspaceId && row.id === agentId);
  }

  async findBySlug(workspaceId: string, slug: string): Promise<Agent | undefined> {
    return this.rows.find((row) => row.workspaceId === workspaceId && row.slug === slug);
  }

  async listByWorkspace(workspaceId: string): Promise<Agent[]> {
    return this.rows.filter((row) => row.workspaceId === workspaceId);
  }

  async create(input: NewAgent): Promise<Agent> {
    const row: Agent = {
      id: input.id ?? nextId('agent'),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      status: input.status ?? 'draft',
      activeVersionId: input.activeVersionId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async updateLifecycle(agentId: string, patch: { status?: Agent['status']; activeVersionId?: string }): Promise<Agent> {
    const row = this.rows.find((r) => r.id === agentId);
    if (!row) {
      throw new Error(`Agent ${agentId} not found`);
    }
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }
}

export class FakeAgentDraftRepository implements AgentDraftPort {
  private readonly rows: AgentDraft[] = [];

  async findByAgentId(agentId: string): Promise<AgentDraft | undefined> {
    return this.rows.find((row) => row.agentId === agentId);
  }

  async create(input: NewAgentDraft): Promise<AgentDraft> {
    const row: AgentDraft = {
      id: input.id ?? nextId('agent-draft'),
      agentId: input.agentId,
      instructions: input.instructions ?? '',
      modelPolicy: input.modelPolicy ?? {},
      knowledgeBindings: input.knowledgeBindings ?? [],
      toolBindings: input.toolBindings ?? [],
      memoryPolicy: input.memoryPolicy ?? {},
      guardrails: input.guardrails ?? {},
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async update(agentId: string, patch: AgentDraftPatch): Promise<AgentDraft> {
    const row = this.rows.find((r) => r.agentId === agentId);
    if (!row) {
      throw new Error(`Draft for agent ${agentId} not found`);
    }
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }
}

export class FakeAgentVersionRepository implements AgentVersionPort {
  private readonly rows: AgentVersion[] = [];

  async create(input: NewAgentVersion): Promise<AgentVersion> {
    const row: AgentVersion = {
      id: input.id ?? nextId('agent-version'),
      agentId: input.agentId,
      versionNumber: input.versionNumber,
      instructions: input.instructions,
      modelPolicy: input.modelPolicy,
      knowledgeBindings: input.knowledgeBindings,
      toolBindings: input.toolBindings,
      memoryPolicy: input.memoryPolicy,
      guardrails: input.guardrails,
      checksum: input.checksum,
      publishedByPrincipalId: input.publishedByPrincipalId,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async findById(agentId: string, versionId: string): Promise<AgentVersion | undefined> {
    return this.rows.find((row) => row.agentId === agentId && row.id === versionId);
  }

  async listByAgent(agentId: string): Promise<AgentVersion[]> {
    return this.rows.filter((row) => row.agentId === agentId).sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async findLatestVersionNumber(agentId: string): Promise<number> {
    const versions = await this.listByAgent(agentId);
    return versions[0]?.versionNumber ?? 0;
  }
}



/** In-memory audit store: implements the read port and records every query for assertions. */
export class FakeAuditReader implements AuditReaderPort {
  private readonly rows: StoredAuditEvent[] = [];
  readonly queries: { organizationId: string; filter: AuditEventFilter; page: AuditPageRequest }[] = [];

  add(event: StoredAuditEvent): void {
    this.rows.push(event);
  }

  async list(organizationId: string, filter: AuditEventFilter, page: AuditPageRequest): Promise<StoredAuditEvent[]> {
    this.queries.push({ organizationId, filter, page });
    return this.rows
      .filter((row) => row.organizationId === organizationId)
      .filter((row) => !filter.workspaceId || row.workspaceId === filter.workspaceId)
      .filter((row) => !filter.action || row.action === filter.action)
      .filter((row) => !filter.actorPrincipalId || row.actorPrincipalId === filter.actorPrincipalId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .filter((row) => {
        if (!page.after) return true;
        const time = row.createdAt.getTime();
        const afterTime = page.after.createdAt.getTime();
        return time < afterTime || (time === afterTime && row.id < page.after.id);
      })
      .slice(0, page.limit);
  }
}

/** Audit log fake: records events (assertable via events) and serves them through the read port. */
export class FakeAuditLog extends FakeAuditReader implements AuditPort {
  readonly events: AuditEvent[] = [];
  private lastTimestamp = 0;

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
    // Strictly increasing, like a database clock with sub-millisecond precision,
    // so tests can assert newest-first order without same-millisecond ties.
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    this.add({
      id: crypto.randomUUID(),
      organizationId: event.organizationId,
      workspaceId: event.workspaceId ?? null,
      actorPrincipalId: event.actorPrincipalId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata ?? null,
      createdAt: new Date(this.lastTimestamp),
    });
  }
}
