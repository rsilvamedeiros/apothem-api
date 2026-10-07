import type { Membership, NewMembership } from '../infrastructure/schema.js';
import type { MembershipReaderPort } from './membership-reader.port.js';

export type MembershipPatch = Partial<Pick<NewMembership, 'role' | 'status'>>;

export interface MembershipPort extends MembershipReaderPort {
  listByOrganization(organizationId: string): Promise<Membership[]>;
  listByPrincipal(principalId: string): Promise<Membership[]>;
  create(input: NewMembership): Promise<Membership>;
  /** Always scoped by organization: a membership is never resolved by id alone. */
  findById(organizationId: string, membershipId: string): Promise<Membership | undefined>;
  update(organizationId: string, membershipId: string, patch: MembershipPatch): Promise<Membership>;
}
