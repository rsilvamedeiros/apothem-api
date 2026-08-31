import { and, eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import { workspaceMemberships, type NewWorkspaceMembership, type WorkspaceMembership } from './schema.js';

/**
 * Scoped by workspaceId, which itself only resolves within an organization
 * (see WorkspaceRepository) — chaining keeps every read tenant-safe.
 */
export class WorkspaceMembershipRepository {
  constructor(private readonly db: Database) {}

  async findByMembershipInWorkspace(
    workspaceId: string,
    membershipId: string,
  ): Promise<WorkspaceMembership | undefined> {
    const [row] = await this.db
      .select()
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.membershipId, membershipId),
        ),
      )
      .limit(1);
    return row;
  }

  async listByWorkspace(workspaceId: string): Promise<WorkspaceMembership[]> {
    return this.db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, workspaceId));
  }

  async create(input: NewWorkspaceMembership): Promise<WorkspaceMembership> {
    const [row] = await this.db.insert(workspaceMemberships).values(input).returning();
    if (!row) {
      throw new Error('Failed to create workspace membership');
    }
    return row;
  }
}
