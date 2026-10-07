import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from '../../organizations/infrastructure/schema.js';
import { workspaces } from '../../workspaces/infrastructure/schema.js';
import { agents } from '../../agents/infrastructure/schema.js';
import { runs } from '../../runs/infrastructure/schema.js';

export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected', 'expired']);

/**
 * A durable, immutable tool proposal waiting for (or carrying) a human
 * decision (ADR-013). `toolName`, `arguments`, `runId` and `stepSequence` are
 * never updated after creation, so approval always resumes exactly what was
 * proposed. Only the decision fields move, once, out of `pending`.
 */
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'restrict' }),
    stepSequence: integer('step_sequence').notNull(),
    toolName: text('tool_name').notNull(),
    arguments: jsonb('arguments').notNull(),
    requestedByPrincipalId: uuid('requested_by_principal_id').notNull(),
    status: approvalStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedByPrincipalId: uuid('decided_by_principal_id'),
    decisionReason: text('decision_reason'),
    /** True when the requester was the only eligible approver (ADR-013); always visible in the audit trail. */
    selfApproved: boolean('self_approved').notNull().default(false),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('approvals_workspace_status_idx').on(table.workspaceId, table.status, table.createdAt),
    uniqueIndex('approvals_run_step_uq').on(table.runId, table.stepSequence),
    // At most one open proposal per run: a run waits on exactly one decision.
    uniqueIndex('approvals_one_pending_per_run_uq').on(table.runId).where(sql`${table.status} = 'pending'`),
  ],
);

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
