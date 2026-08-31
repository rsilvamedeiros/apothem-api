import { and, eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { workspaces, type NewWorkspace, type Workspace } from './schema.js';

/**
 * Every lookup requires organizationId so a workspace from another tenant can
 * never be resolved by a bare workspace id — see tenant-isolation.md.
 */
export class WorkspaceRepository {
  constructor(private readonly db: Database) {}

  async findById(organizationId: string, workspaceId: string): Promise<Workspace | undefined> {
    const [row] = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.id, workspaceId)))
      .limit(1);
    return row;
  }

  async findBySlug(organizationId: string, slug: string): Promise<Workspace | undefined> {
    const [row] = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.slug, slug)))
      .limit(1);
    return row;
  }

  async listByOrganization(organizationId: string): Promise<Workspace[]> {
    return this.db.select().from(workspaces).where(eq(workspaces.organizationId, organizationId));
  }

  async create(input: NewWorkspace): Promise<Workspace> {
    const [row] = await this.db.insert(workspaces).values(input).returning();
    if (!row) {
      throw new Error('Failed to create workspace');
    }
    return row;
  }
}
