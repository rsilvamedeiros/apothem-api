import type { Membership, NewMembership } from '../infrastructure/schema.js';
import type { MembershipReaderPort } from './membership-reader.port.js';

export interface MembershipPort extends MembershipReaderPort {
  listByOrganization(organizationId: string): Promise<Membership[]>;
  listByPrincipal(principalId: string): Promise<Membership[]>;
  create(input: NewMembership): Promise<Membership>;
}
