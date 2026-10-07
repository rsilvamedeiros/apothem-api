import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import type {
  ApprovalDecisionPatch,
  ApprovalFilter,
  ApprovalPageRequest,
  ApprovalPort,
} from '../application/approval.port.js';
import { approvals, type Approval, type NewApproval } from './schema.js';

export class ApprovalRepository implements ApprovalPort {
  constructor(private readonly db: Database) {}

  async create(input: NewApproval): Promise<Approval> {
    const [row] = await this.db.insert(approvals).values(input).returning();
    if (!row) {
      throw new Error('Failed to create approval');
    }
    return row;
  }

  async findById(workspaceId: string, approvalId: string): Promise<Approval | undefined> {
    const [row] = await this.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.workspaceId, workspaceId), eq(approvals.id, approvalId)))
      .limit(1);
    return row;
  }

  async findPendingByRun(workspaceId: string, runId: string): Promise<Approval | undefined> {
    const [row] = await this.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.workspaceId, workspaceId), eq(approvals.runId, runId), eq(approvals.status, 'pending')))
      .limit(1);
    return row;
  }

  async list(workspaceId: string, filter: ApprovalFilter, page: ApprovalPageRequest): Promise<Approval[]> {
    // The workspace predicate is unconditional; every other condition only narrows it.
    const conditions: SQL[] = [eq(approvals.workspaceId, workspaceId)];
    if (filter.status) conditions.push(eq(approvals.status, filter.status));
    if (filter.runId) conditions.push(eq(approvals.runId, filter.runId));
    if (page.after) {
      const keyset = or(
        lt(approvals.createdAt, page.after.createdAt),
        and(eq(approvals.createdAt, page.after.createdAt), lt(approvals.id, page.after.id)),
      );
      if (keyset) conditions.push(keyset);
    }
    return this.db
      .select()
      .from(approvals)
      .where(and(...conditions))
      .orderBy(desc(approvals.createdAt), desc(approvals.id))
      .limit(page.limit);
  }

  async decide(workspaceId: string, approvalId: string, patch: ApprovalDecisionPatch): Promise<Approval | undefined> {
    const [row] = await this.db
      .update(approvals)
      .set({
        status: patch.status,
        decidedByPrincipalId: patch.decidedByPrincipalId ?? null,
        decisionReason: patch.decisionReason ?? null,
        selfApproved: patch.selfApproved ?? false,
        decidedAt: patch.decidedAt,
      })
      .where(and(eq(approvals.workspaceId, workspaceId), eq(approvals.id, approvalId), eq(approvals.status, 'pending')))
      .returning();
    return row;
  }
}
