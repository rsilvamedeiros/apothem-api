import { eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { principals, type NewPrincipal, type Principal } from './schema.js';
import type { PrincipalPort } from '../application/principal.port.js';

export class PrincipalRepository implements PrincipalPort {
  constructor(private readonly db: Database) {}

  async findById(principalId: string): Promise<Principal | undefined> {
    const [row] = await this.db.select().from(principals).where(eq(principals.id, principalId)).limit(1);
    return row;
  }

  async findByEmail(email: string): Promise<Principal | undefined> {
    const [row] = await this.db.select().from(principals).where(sql`lower(${principals.email}) = ${email.trim().toLowerCase()}`).limit(1);
    return row;
  }

  async findManyByIds(principalIds: readonly string[]): Promise<Principal[]> {
    if (principalIds.length === 0) {
      return [];
    }
    return this.db.select().from(principals).where(inArray(principals.id, [...principalIds]));
  }

  async create(input: NewPrincipal): Promise<Principal> {
    const [row] = await this.db.insert(principals).values(input).returning();
    if (!row) {
      throw new Error('Failed to create principal');
    }
    return row;
  }
}
