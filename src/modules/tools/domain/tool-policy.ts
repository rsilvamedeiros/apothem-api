/**
 * Policy evaluation for a model-proposed tool call (ADR-013, ADR-015). Pure
 * and deterministic: authorization and thresholds belong in code, never in the
 * prompt. Anything not explicitly safe fails closed to "ask a human".
 */
export const TOOL_RISKS = ['read_only', 'reversible_write', 'irreversible'] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];

export const APPROVAL_MODES = ['auto', 'required'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export interface ToolBindingRef {
  readonly approval: ApprovalMode;
}

/**
 * A workspace rule is a ceiling set by an owner or admin (ADR-015): it can
 * block a tool or force approval, and it can never enable or relax anything.
 */
export const WORKSPACE_TOOL_RULES = ['blocked', 'approval_required'] as const;
export type WorkspaceToolRule = (typeof WORKSPACE_TOOL_RULES)[number];

export type PolicyDecision =
  | { readonly outcome: 'allow' }
  | { readonly outcome: 'require_approval' }
  | { readonly outcome: 'deny'; readonly reason: 'TOOL_NOT_BOUND' | 'TOOL_BLOCKED_BY_POLICY' };

/**
 * Order of precedence, strictest first: unbound, blocked by the workspace,
 * then approval (irreversible risk, workspace rule, binding), then allow.
 */
export function evaluateToolPolicy(input: {
  risk: ToolRisk;
  binding: ToolBindingRef | undefined;
  workspaceRule?: WorkspaceToolRule | undefined;
}): PolicyDecision {
  if (!input.binding) {
    return { outcome: 'deny', reason: 'TOOL_NOT_BOUND' };
  }

  // Any rule other than the known "approval_required" is read as the strictest one.
  if (input.workspaceRule !== undefined && input.workspaceRule !== 'approval_required') {
    return { outcome: 'deny', reason: 'TOOL_BLOCKED_BY_POLICY' };
  }

  // An irreversible action is never waived by a binding, and a workspace can always ask first.
  if (input.risk === 'irreversible' || input.workspaceRule === 'approval_required') {
    return { outcome: 'require_approval' };
  }

  const known = input.risk === 'read_only' || input.risk === 'reversible_write';
  if (!known || input.binding.approval !== 'auto') {
    // "required", an unknown mode and an unknown risk all end up at a human.
    return { outcome: 'require_approval' };
  }
  return { outcome: 'allow' };
}
