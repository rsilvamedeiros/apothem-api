import type { OrganizationRole } from '../../authorization/domain/role.js';

export interface MembershipRecord {
  readonly id: string;
  readonly role: OrganizationRole;
  readonly status: 'active' | 'invited' | 'revoked';
}

export interface MembershipReaderPort {
  findByPrincipalInOrganization(
    organizationId: string,
    principalId: string,
  ): Promise<MembershipRecord | undefined>;
}
