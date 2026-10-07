/**
 * Run lifecycle (apothem-ai/docs/03-domain/executions-audit.md). Approval
 * waiting states arrive with the approvals module; until then a run goes
 * queued -> running -> one terminal state, and a terminal run is never rewritten.
 */
export const RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  // hasOwn guards against inherited keys such as "toString".
  return Object.hasOwn(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

export function isTerminal(status: RunStatus): boolean {
  return Object.hasOwn(TRANSITIONS, status) && TRANSITIONS[status].length === 0;
}

/**
 * Stable public error codes (agent-runtime.md "Runtime error taxonomy").
 * Provider-specific text is never part of this contract.
 */
export const RUN_ERROR_CODES = [
  'RUN_CONFIG_INVALID',
  'MODEL_POLICY_NO_ROUTE',
  'MODEL_PROVIDER_UNAVAILABLE',
  'MODEL_REQUEST_REJECTED',
  'RUN_BUDGET_EXCEEDED',
  'TOOL_NOT_BOUND',
  'RUN_INTERNAL_ERROR',
] as const;
export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];
