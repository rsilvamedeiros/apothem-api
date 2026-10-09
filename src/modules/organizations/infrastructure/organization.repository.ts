import { eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { memberships, organizations, type Membership, type NewOrganization, type Organization } from './schema.js';
import type { OrganizationPort } from '../application/organization.port.js';

/**
 * Organizations are the tenant root — the only repository in this module
 * allowed to look up a row by id alone, since there is no wider scope above it.
 */
export class OrganizationRepository implements OrganizationPort {
  constructor(private readonly db: Database) {}

  async findById(organizationId: string): Promise<Organization | undefined> {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return row;
  }

  async findBySlug(slug: string): Promise<Organization | undefined> {
    const [row] = await this.db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    return row;
  }

  async createWithOwner(
    input: NewOrganization,
    ownerPrincipalId: string,
  ): Promise<{ organization: Organization; membership: Membership }> {
    // One transaction: a failure on either insert (including a slug that a concurrent request took) leaves nothing behind.
    return this.db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values(input).returning();
      if (!organization) {
        throw new Error('Failed to create organization');
      }
      const [membership] = await tx
        .insert(memberships)
        .values({ organizationId: organization.id, principalId: ownerPrincipalId, role: 'owner', status: 'active' })
        .returning();
      if (!membership) {
        throw new Error('Failed to create the owner membership');
      }
      return { organization, membership };
    });
  }

  async create(input: NewOrganization): Promise<Organization> {
    const [row] = await this.db.insert(organizations).values(input).returning();
    if (!row) {
      throw new Error('Failed to create organization');
    }
    return row;
  }
}
