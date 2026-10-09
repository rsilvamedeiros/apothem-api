import type { Membership, Organization, NewOrganization } from '../infrastructure/schema.js';

export interface OrganizationPort {
  findById(organizationId: string): Promise<Organization | undefined>;
  findBySlug(slug: string): Promise<Organization | undefined>;
  create(input: NewOrganization): Promise<Organization>;
  /**
   * Stores the organization and its first membership, an active owner, as one
   * atomic write: either both exist afterwards or neither does. An
   * organization without an owner could never be reached through the API.
   */
  createWithOwner(input: NewOrganization, ownerPrincipalId: string): Promise<{ organization: Organization; membership: Membership }>;
}
