import { eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { organizations, type NewOrganization, type Organization } from './schema.js';

/**
 * Organizations are the tenant root — the only repository in this module
 * allowed to look up a row by id alone, since there is no wider scope above it.
 */
export class OrganizationRepository {
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

  async create(input: NewOrganization): Promise<Organization> {
    const [row] = await this.db.insert(organizations).values(input).returning();
    if (!row) {
      throw new Error('Failed to create organization');
    }
    return row;
  }
}
