import type { SetToolPolicyInput, ToolPolicyPort } from '../tool-policy.port.js';
import type { ToolPolicy } from '../../infrastructure/schema.js';

export class FakeToolPolicyRepository implements ToolPolicyPort {
  readonly rows: ToolPolicy[] = [];

  async listByWorkspace(workspaceId: string): Promise<ToolPolicy[]> {
    return this.rows
      .filter((row) => row.workspaceId === workspaceId)
      .sort((a, b) => a.toolName.localeCompare(b.toolName))
      .map((row) => ({ ...row }));
  }

  async findByTool(workspaceId: string, toolName: string): Promise<ToolPolicy | undefined> {
    const row = this.rows.find((r) => r.workspaceId === workspaceId && r.toolName === toolName);
    return row ? { ...row } : undefined;
  }

  async upsert(input: SetToolPolicyInput): Promise<ToolPolicy> {
    const now = new Date();
    const existing = this.rows.find((r) => r.workspaceId === input.workspaceId && r.toolName === input.toolName);
    if (existing) {
      Object.assign(existing, { rule: input.rule, updatedByPrincipalId: input.updatedByPrincipalId, updatedAt: now });
      return { ...existing };
    }
    const row: ToolPolicy = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      toolName: input.toolName,
      rule: input.rule,
      updatedByPrincipalId: input.updatedByPrincipalId,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return { ...row };
  }

  async remove(workspaceId: string, toolName: string): Promise<boolean> {
    const index = this.rows.findIndex((r) => r.workspaceId === workspaceId && r.toolName === toolName);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }
}
