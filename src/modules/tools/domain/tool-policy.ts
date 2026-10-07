/**
 * Policy evaluation for a model-proposed tool call (ADR-013). Pure and
 * deterministic: authorization and thresholds belong in code, never in the
 * prompt. Anything not explicitly safe fails closed to "ask a human".
 */
export const TOOL_RISKS = ['read_only', 'reversible_write', 'irreversible'] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];

export const APPROVAL_MODES = ['auto', 'required'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export interface ToolBindingRef {
  readonly approval: ApprovalMode;
}

export type PolicyDecision =
  | { readonly outcome: 'allow' }
  | { readonly outcome: 'require_approval' }
  | { readonly outcome: 'deny'; readonly reason: 'TOOL_NOT_BOUND' };

export function evaluateToolPolicy(input: {
  risk: ToolRisk;
  binding: ToolBindingRef | undefined;
}): PolicyDecision {
  if (!input.binding) {
    return { outcome: 'deny', reason: 'TOOL_NOT_BOUND' };
  }

  // An irreversible action is never waived by a binding.
  if (input.risk === 'irreversible') {
    return { outcome: 'require_approval' };
  }

  const known = input.risk === 'read_only' || input.risk === 'reversible_write';
  if (!known || input.binding.approval !== 'auto') {
    // "required", an unknown mode and an unknown risk all end up at a human.
    return { outcome: 'require_approval' };
  }
  return { outcome: 'allow' };
}
