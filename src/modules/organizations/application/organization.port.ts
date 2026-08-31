import type { Organization, NewOrganization } from '../infrastructure/schema.js';

export interface OrganizationPort {
  findById(organizationId: string): Promise<Organization | undefined>;
  findBySlug(slug: string): Promise<Organization | undefined>;
  create(input: NewOrganization): Promise<Organization>;
}
