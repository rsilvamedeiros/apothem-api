import type { OrganizationRole } from '../../authorization/domain/role.js';

export interface WorkspaceMembershipRecord {
  readonly role: OrganizationRole | null;
}

export interface WorkspaceMembershipReaderPort {
  findByMembershipInWorkspace(
    workspaceId: string,
    membershipId: string,
  ): Promise<WorkspaceMembershipRecord | undefined>;
}
