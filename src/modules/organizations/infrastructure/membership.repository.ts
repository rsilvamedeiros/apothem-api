import { and, eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { memberships, type Membership, type NewMembership } from './schema.js';
import type { MembershipPort } from '../application/membership.port.js';

/**
 * All lookups require organizationId — membership rows are never resolved
 * by id alone so a caller cannot probe another tenant's membership by guessing ids.
 */
export class MembershipRepository implements MembershipPort {
  constructor(private readonly db: Database) {}

  async findByPrincipalInOrganization(
    organizationId: string,
    principalId: string,
  ): Promise<Membership | undefined> {
    const [row] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.principalId, principalId)))
      .limit(1);
    return row;
  }

  async listByOrganization(organizationId: string): Promise<Membership[]> {
    return this.db.select().from(memberships).where(eq(memberships.organizationId, organizationId));
  }

  async listByPrincipal(principalId: string): Promise<Membership[]> {
    return this.db.select().from(memberships).where(eq(memberships.principalId, principalId));
  }

  async create(input: NewMembership): Promise<Membership> {
    const [row] = await this.db.insert(memberships).values(input).returning();
    if (!row) {
      throw new Error('Failed to create membership');
    }
    return row;
  }
}
