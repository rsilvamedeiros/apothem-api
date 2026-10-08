import type { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { AuditPort } from '../../audit/application/audit.port.js';
import { ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import { getToolDefinition } from '../domain/tool-catalog.js';
import { WORKSPACE_TOOL_RULES, type WorkspaceToolRule } from '../domain/tool-policy.js';
import type { ToolPolicy } from '../infrastructure/schema.js';
import type { ToolPolicyPort } from './tool-policy.port.js';

export interface SetToolPolicyResult {
  policy: ToolPolicy;
  /** False when the same rule was already in place and nothing was written. */
  changed: boolean;
}

function requireWorkspaceScope(context: TenantContext): string {
  if (!context.workspaceId) {
    throw new ForbiddenError('Tool policies require a resolved workspace scope');
  }
  return context.workspaceId;
}

/**
 * Workspace rules for tools (ADR-015): a ceiling set by owners and admins.
 * The workspace always comes from the authenticated context, the tool must be
 * in the catalog, and every change is audited with the tool and the rules
 * involved, never with free text.
 */
export class ToolPolicyService {
  constructor(
    private readonly policies: ToolPolicyPort,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditPort,
  ) {}

  /** Anyone who can read agents can see why a tool is unavailable. */
  async list(context: TenantContext): Promise<ToolPolicy[]> {
    this.authorization.assert(context, 'agent.read');
    return this.policies.listByWorkspace(requireWorkspaceScope(context));
  }

  async set(context: TenantContext, toolName: string, rule: WorkspaceToolRule): Promise<SetToolPolicyResult> {
    this.authorization.assert(context, 'policy.manage');
    const workspaceId = requireWorkspaceScope(context);
    if (!getToolDefinition(toolName)) {
      throw new NotFoundError(`Tool ${toolName} not found`);
    }
    if (!WORKSPACE_TOOL_RULES.includes(rule)) {
      throw new InvalidInputError(`Rule must be one of: ${WORKSPACE_TOOL_RULES.join(', ')}`);
    }

    const previous = await this.policies.findByTool(workspaceId, toolName);
    if (previous?.rule === rule) {
      return { policy: previous, changed: false };
    }

    const policy = await this.policies.upsert({
      organizationId: context.organizationId,
      workspaceId,
      toolName,
      rule,
      updatedByPrincipalId: context.principal.id,
    });
    await this.audit.record({
      organizationId: context.organizationId,
      workspaceId,
      actorPrincipalId: context.principal.id,
      action: 'tool_policy.set',
      targetType: 'tool_policy',
      targetId: policy.id,
      metadata: { tool: toolName, rule, previousRule: previous?.rule ?? null },
    });
    return { policy, changed: true };
  }

  async remove(context: TenantContext, toolName: string): Promise<boolean> {
    this.authorization.assert(context, 'policy.manage');
    const workspaceId = requireWorkspaceScope(context);

    const previous = await this.policies.findByTool(workspaceId, toolName);
    if (!previous || !(await this.policies.remove(workspaceId, toolName))) {
      return false;
    }
    await this.audit.record({
      organizationId: context.organizationId,
      workspaceId,
      actorPrincipalId: context.principal.id,
      action: 'tool_policy.removed',
      targetType: 'tool_policy',
      targetId: previous.id,
      metadata: { tool: toolName, previousRule: previous.rule },
    });
    return true;
  }
}
