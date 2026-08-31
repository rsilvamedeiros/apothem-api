import { eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { principals, type NewPrincipal, type Principal } from './schema.js';

export class PrincipalRepository {
  constructor(private readonly db: Database) {}

  async findById(principalId: string): Promise<Principal | undefined> {
    const [row] = await this.db.select().from(principals).where(eq(principals.id, principalId)).limit(1);
    return row;
  }

  async findByEmail(email: string): Promise<Principal | undefined> {
    const [row] = await this.db.select().from(principals).where(eq(principals.email, email)).limit(1);
    return row;
  }

  async create(input: NewPrincipal): Promise<Principal> {
    const [row] = await this.db.insert(principals).values(input).returning();
    if (!row) {
      throw new Error('Failed to create principal');
    }
    return row;
  }
}
