import type { AuditEvent, AuditPort } from '../../../modules/audit/application/audit.port.js';
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

/**
 * In-memory stand-ins for the Drizzle repositories, structurally compatible
 * with the concrete repository classes (same public method shapes) so they
 * can be passed straight into the real application services under test —
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

export class FakeAuditLog implements AuditPort {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}
