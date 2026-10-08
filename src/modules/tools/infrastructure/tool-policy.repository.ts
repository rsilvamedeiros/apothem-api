import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import type { SetToolPolicyInput, ToolPolicyPort } from '../application/tool-policy.port.js';
import { toolPolicies, type ToolPolicy } from './schema.js';

export class ToolPolicyRepository implements ToolPolicyPort {
  constructor(private readonly db: Database) {}

  async listByWorkspace(workspaceId: string): Promise<ToolPolicy[]> {
    return this.db.select().from(toolPolicies).where(eq(toolPolicies.workspaceId, workspaceId)).orderBy(asc(toolPolicies.toolName));
  }

  async findByTool(workspaceId: string, toolName: string): Promise<ToolPolicy | undefined> {
    const [row] = await this.db
      .select()
      .from(toolPolicies)
      .where(and(eq(toolPolicies.workspaceId, workspaceId), eq(toolPolicies.toolName, toolName)))
      .limit(1);
    return row;
  }

  async upsert(input: SetToolPolicyInput): Promise<ToolPolicy> {
    const [row] = await this.db
      .insert(toolPolicies)
      .values(input)
      .onConflictDoUpdate({
        target: [toolPolicies.workspaceId, toolPolicies.toolName],
        set: { rule: input.rule, updatedByPrincipalId: input.updatedByPrincipalId, updatedAt: new Date() },
      })
      .returning();
    if (!row) {
      throw new Error('Failed to save tool policy');
    }
    return row;
  }

  async remove(workspaceId: string, toolName: string): Promise<boolean> {
    const rows = await this.db
      .delete(toolPolicies)
      .where(and(eq(toolPolicies.workspaceId, workspaceId), eq(toolPolicies.toolName, toolName)))
      .returning({ id: toolPolicies.id });
    return rows.length > 0;
  }
}
