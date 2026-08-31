import type { MembershipReaderPort, MembershipRecord } from '../../../organizations/application/membership-reader.port.js';
import type { WorkspaceReaderPort, WorkspaceRecord } from '../../../workspaces/application/workspace-reader.port.js';
import type {
  WorkspaceMembershipReaderPort,
  WorkspaceMembershipRecord,
} from '../../../workspaces/application/workspace-membership-reader.port.js';
import type { AuthenticatedPrincipal } from '../../../identity/application/principal.js';

/**
 * Shared role/capability test fixtures: two tenants (ORG_A/ORG_B), each with
 * one workspace, so tests can assert both "capability matches role" and
 * "membership in one tenant never grants access to another".
 */
export const FIXTURE_PRINCIPALS = {
  ownerA: { id: 'principal-owner-a', type: 'user', email: 'owner-a@example.com', name: 'Owner A' } satisfies AuthenticatedPrincipal,
  operatorA: { id: 'principal-operator-a', type: 'user', email: 'operator-a@example.com', name: 'Operator A' } satisfies AuthenticatedPrincipal,
  revokedA: { id: 'principal-revoked-a', type: 'user', email: 'revoked-a@example.com', name: 'Revoked A' } satisfies AuthenticatedPrincipal,
  outsider: { id: 'principal-outsider', type: 'user', email: 'outsider@example.com', name: 'Outsider' } satisfies AuthenticatedPrincipal,
  ownerB: { id: 'principal-owner-b', type: 'user', email: 'owner-b@example.com', name: 'Owner B' } satisfies AuthenticatedPrincipal,
};

export const ORG_A = 'org-a';
export const ORG_B = 'org-b';
export const WORKSPACE_A = 'workspace-a';
export const WORKSPACE_B = 'workspace-b';

interface MembershipRow extends MembershipRecord {
  organizationId: string;
  principalId: string;
}

const MEMBERSHIP_ROWS: MembershipRow[] = [
  { id: 'membership-owner-a', organizationId: ORG_A, principalId: FIXTURE_PRINCIPALS.ownerA.id, role: 'owner', status: 'active' },
  { id: 'membership-operator-a', organizationId: ORG_A, principalId: FIXTURE_PRINCIPALS.operatorA.id, role: 'operator', status: 'active' },
  { id: 'membership-revoked-a', organizationId: ORG_A, principalId: FIXTURE_PRINCIPALS.revokedA.id, role: 'admin', status: 'revoked' },
  { id: 'membership-owner-b', organizationId: ORG_B, principalId: FIXTURE_PRINCIPALS.ownerB.id, role: 'owner', status: 'active' },
];

const WORKSPACE_ROWS: (WorkspaceRecord & { organizationId: string })[] = [
  { id: WORKSPACE_A, organizationId: ORG_A, status: 'active' },
  { id: WORKSPACE_B, organizationId: ORG_B, status: 'active' },
];

const WORKSPACE_MEMBERSHIP_ROWS: (WorkspaceMembershipRecord & { workspaceId: string; membershipId: string })[] = [
  { workspaceId: WORKSPACE_A, membershipId: 'membership-operator-a', role: 'builder' },
];

export class FakeMembershipReader implements MembershipReaderPort {
  async findByPrincipalInOrganization(
    organizationId: string,
    principalId: string,
  ): Promise<MembershipRecord | undefined> {
    return MEMBERSHIP_ROWS.find(
      (row) => row.organizationId === organizationId && row.principalId === principalId,
    );
  }
}

export class FakeWorkspaceReader implements WorkspaceReaderPort {
  async findById(organizationId: string, workspaceId: string): Promise<WorkspaceRecord | undefined> {
    return WORKSPACE_ROWS.find((row) => row.organizationId === organizationId && row.id === workspaceId);
  }
}

export class FakeWorkspaceMembershipReader implements WorkspaceMembershipReaderPort {
  async findByMembershipInWorkspace(
    workspaceId: string,
    membershipId: string,
  ): Promise<WorkspaceMembershipRecord | undefined> {
    return WORKSPACE_MEMBERSHIP_ROWS.find(
      (row) => row.workspaceId === workspaceId && row.membershipId === membershipId,
    );
  }
}
