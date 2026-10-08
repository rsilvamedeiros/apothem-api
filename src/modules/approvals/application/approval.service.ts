import type { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import { ROLE_CAPABILITIES } from '../../authorization/domain/role.js';
import type { AuditPort } from '../../audit/application/audit.port.js';
import type { AgentPort } from '../../agents/application/agent.port.js';
import type { MembershipPort } from '../../organizations/application/membership.port.js';
import type { RunService } from '../../runs/application/run.service.js';
import type { Run } from '../../runs/infrastructure/schema.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../common/keyset-cursor.js';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import type { Approval } from '../infrastructure/schema.js';
import type { ApprovalPort } from './approval.port.js';

export const DEFAULT_APPROVAL_PAGE_SIZE = 25;
export const MAX_APPROVAL_PAGE_SIZE = 100;
export const MAX_DECISION_REASON_LENGTH = 500;

export interface DecideInput {
  decision: 'approve' | 'reject';
  reason?: string | undefined;
}

export interface DecisionResult {
  approval: Approval;
  run: Run;
}

export interface ApprovalQuery {
  status?: Approval['status'] | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface ApprovalPage {
  approvals: Approval[];
  nextCursor: string | null;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_APPROVAL_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_APPROVAL_PAGE_SIZE);
}

function requireWorkspaceScope(context: TenantContext): string {
  if (!context.workspaceId) {
    throw new ForbiddenError('Approvals require a resolved workspace scope');
  }
  return context.workspaceId;
}

/**
 * Human decisions on tool proposals (ADR-007, ADR-013). The proposal is
 * immutable; a decision is a compare-and-set out of `pending`, so it happens
 * exactly once. Approving executes the persisted proposal and resumes the
 * run; rejecting, expiring and invalidating end it without any action.
 */
export class ApprovalService {
  constructor(
    private readonly approvals: ApprovalPort,
    private readonly runs: RunService,
    private readonly agents: AgentPort,
    private readonly memberships: MembershipPort,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(context: TenantContext, query: ApprovalQuery): Promise<ApprovalPage> {
    this.authorization.assert(context, 'approval.decide');
    const workspaceId = requireWorkspaceScope(context);

    const limit = clampLimit(query.limit);
    const after = query.cursor === undefined ? undefined : decodeKeysetCursor(query.cursor);

    // Never offer a request nobody can act on any more.
    await this.expireStale(context, workspaceId);

    const rows = await this.approvals.list(workspaceId, { status: query.status }, { limit: limit + 1, after });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      approvals: page,
      nextCursor: rows.length > limit && last ? encodeKeysetCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  async decide(context: TenantContext, approvalId: string, input: DecideInput): Promise<DecisionResult> {
    this.authorization.assert(context, 'approval.decide');
    const workspaceId = requireWorkspaceScope(context);

    const reason = input.reason?.trim() || undefined;
    if (reason !== undefined && reason.length > MAX_DECISION_REASON_LENGTH) {
      throw new InvalidInputError(`Reason must be at most ${MAX_DECISION_REASON_LENGTH} characters`);
    }

    const approval = await this.approvals.findById(workspaceId, approvalId);
    if (!approval) {
      throw new NotFoundError(`Approval ${approvalId} not found`);
    }
    if (approval.status !== 'pending') {
      throw new ConflictError(`This approval was already ${approval.status}`);
    }

    const decidedAt = this.now();
    if (decidedAt.getTime() > approval.expiresAt.getTime()) {
      await this.expire(context.principal.id, approval);
      throw new ConflictError('This approval request expired');
    }

    const selfApproved = await this.assertSeparationOfDuties(context, approval);

    if (input.decision === 'reject') {
      const rejected = await this.approvals.decide(workspaceId, approval.id, {
        status: 'rejected',
        decidedByPrincipalId: context.principal.id,
        decisionReason: reason ?? null,
        selfApproved,
        decidedAt,
      });
      if (!rejected) throw new ConflictError('This approval was already decided');
      await this.recordDecision(context, 'approval.rejected', rejected, selfApproved, reason !== undefined);
      const run = await this.runs.failWaitingRun(rejected, 'APPROVAL_REJECTED', context.principal.id);
      return { approval: rejected, run };
    }

    // Conditions that can invalidate an approval are re-checked before anything runs.
    const invalidation = await this.invalidationReason(workspaceId, approval);
    if (invalidation) {
      const invalidated = await this.approvals.decide(workspaceId, approval.id, {
        status: 'rejected',
        decidedByPrincipalId: context.principal.id,
        decisionReason: `Invalidated: ${invalidation}`,
        selfApproved,
        decidedAt,
      });
      if (invalidated) {
        await this.recordDecision(context, 'approval.invalidated', invalidated, selfApproved, true);
        await this.runs.failWaitingRun(invalidated, 'APPROVAL_INVALIDATED', context.principal.id);
      }
      throw new ConflictError('This approval no longer applies and was closed');
    }

    const approved = await this.approvals.decide(workspaceId, approval.id, {
      status: 'approved',
      decidedByPrincipalId: context.principal.id,
      decisionReason: reason ?? null,
      selfApproved,
      decidedAt,
    });
    if (!approved) throw new ConflictError('This approval was already decided');

    // The decision is on record before anything executes.
    await this.recordDecision(context, 'approval.approved', approved, selfApproved, reason !== undefined);
    const run = await this.runs.resumeAfterApproval(approved, context.principal.id);
    return { approval: approved, run };
  }

  /**
   * The requester cannot approve their own proposal while another eligible
   * approver exists. A sole eligible approver may, and it is marked
   * `selfApproved` so the decision stays explicit and reviewable.
   */
  private async assertSeparationOfDuties(context: TenantContext, approval: Approval): Promise<boolean> {
    if (approval.requestedByPrincipalId !== context.principal.id) {
      return false;
    }
    const members = await this.memberships.listByOrganization(context.organizationId);
    const otherApprover = members.some(
      (member) =>
        member.status === 'active' &&
        member.principalId !== approval.requestedByPrincipalId &&
        Object.hasOwn(ROLE_CAPABILITIES, member.role) &&
        ROLE_CAPABILITIES[member.role].has('approval.decide'),
    );
    if (otherApprover) {
      throw new ForbiddenError('Another approver must decide a request you started');
    }
    return true;
  }

  private async invalidationReason(workspaceId: string, approval: Approval): Promise<string | undefined> {
    const agent = await this.agents.findById(workspaceId, approval.agentId);
    if (!agent || agent.status !== 'active') {
      return 'the agent is no longer active';
    }
    const run = await this.runs.findRun(workspaceId, approval.runId);
    if (!run || run.status !== 'waiting_approval') {
      return 'the run is no longer waiting';
    }
    // A rule set after the proposal was made still wins (ADR-015). If it cannot be read, nothing is approved.
    if (await this.runs.isToolBlocked(workspaceId, approval.toolName)) {
      return 'the tool is blocked by a workspace policy';
    }
    return undefined;
  }

  private async expire(actorPrincipalId: string, approval: Approval): Promise<void> {
    const expired = await this.approvals.decide(approval.workspaceId, approval.id, {
      status: 'expired',
      decidedAt: this.now(),
    });
    if (!expired) return;
    await this.audit.record({
      organizationId: expired.organizationId,
      workspaceId: expired.workspaceId,
      actorPrincipalId,
      action: 'approval.expired',
      targetType: 'approval',
      targetId: expired.id,
      metadata: { runId: expired.runId, tool: expired.toolName },
    });
    await this.runs.failWaitingRun(expired, 'APPROVAL_EXPIRED', actorPrincipalId);
  }

  private async expireStale(context: TenantContext, workspaceId: string): Promise<void> {
    const pending = await this.approvals.list(workspaceId, { status: 'pending' }, { limit: MAX_APPROVAL_PAGE_SIZE });
    const nowMs = this.now().getTime();
    for (const approval of pending) {
      if (approval.expiresAt.getTime() < nowMs) {
        await this.expire(context.principal.id, approval);
      }
    }
  }

  private async recordDecision(
    context: TenantContext,
    action: string,
    approval: Approval,
    selfApproved: boolean,
    hasReason: boolean,
  ): Promise<void> {
    await this.audit.record({
      organizationId: approval.organizationId,
      workspaceId: approval.workspaceId,
      actorPrincipalId: context.principal.id,
      action,
      targetType: 'approval',
      targetId: approval.id,
      // The free-text reason and the tool arguments stay in their own records, not in audit.
      metadata: { runId: approval.runId, tool: approval.toolName, selfApproved, hasReason },
    });
  }
}
