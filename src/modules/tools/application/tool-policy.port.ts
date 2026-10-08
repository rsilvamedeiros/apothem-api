import type { WorkspaceToolRule } from '../domain/tool-policy.js';
import type { ToolPolicy } from '../infrastructure/schema.js';

export interface SetToolPolicyInput {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly toolName: string;
  readonly rule: WorkspaceToolRule;
  readonly updatedByPrincipalId: string;
}

/** Every query is scoped by workspace. */
export interface ToolPolicyPort {
  listByWorkspace(workspaceId: string): Promise<ToolPolicy[]>;
  findByTool(workspaceId: string, toolName: string): Promise<ToolPolicy | undefined>;
  /** Creates the rule, or replaces the rule that was there. */
  upsert(input: SetToolPolicyInput): Promise<ToolPolicy>;
  /** `false` when there was no rule. */
  remove(workspaceId: string, toolName: string): Promise<boolean>;
}
