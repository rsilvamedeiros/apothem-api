import type { Approval, NewApproval } from '../infrastructure/schema.js';

export interface ApprovalFilter {
  readonly status?: Approval['status'] | undefined;
  readonly runId?: string | undefined;
}

export interface ApprovalPageRequest {
  readonly limit: number;
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

export interface ApprovalDecisionPatch {
  readonly status: 'approved' | 'rejected' | 'expired';
  readonly decidedByPrincipalId?: string | null;
  readonly decisionReason?: string | null;
  readonly selfApproved?: boolean;
  readonly decidedAt: Date;
}

/**
 * Every query is scoped by workspace. The proposal (tool, arguments, run) is
 * immutable: the only write after creation is `decide`, a compare-and-set out
 * of `pending`, so an approval can be decided exactly once.
 */
export interface ApprovalPort {
  create(input: NewApproval): Promise<Approval>;
  findById(workspaceId: string, approvalId: string): Promise<Approval | undefined>;
  findPendingByRun(workspaceId: string, runId: string): Promise<Approval | undefined>;
  list(workspaceId: string, filter: ApprovalFilter, page: ApprovalPageRequest): Promise<Approval[]>;
  /** Returns `undefined` when the approval is no longer pending (someone else decided first). */
  decide(workspaceId: string, approvalId: string, patch: ApprovalDecisionPatch): Promise<Approval | undefined>;
}
