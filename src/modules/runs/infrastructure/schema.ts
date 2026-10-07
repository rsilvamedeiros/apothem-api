import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '../../organizations/infrastructure/schema.js';
import { workspaces } from '../../workspaces/infrastructure/schema.js';
import { agents, agentVersions } from '../../agents/infrastructure/schema.js';

export const runStatusEnum = pgEnum('run_status', ['queued', 'running', 'completed', 'failed', 'cancelled']);

/**
 * Durable record of one execution attempt. Terminal rows are never rewritten:
 * the repository only advances a run along the state machine in
 * runs/domain/run-state.ts, and there is no delete operation.
 *
 * `agentVersionId` pins the exact immutable version that ran, which is what
 * makes a run reproducible and explainable later.
 */
export const runs = pgTable(
  'runs',
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
    agentVersionId: uuid('agent_version_id')
      .notNull()
      .references(() => agentVersions.id, { onDelete: 'restrict' }),
    requestedByPrincipalId: uuid('requested_by_principal_id').notNull(),
    status: runStatusEnum('status').notNull().default('queued'),
    /** Caller-supplied key making "start run" safe to retry; unique per workspace when present. */
    idempotencyKey: text('idempotency_key'),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    /** Stable public code (RunErrorCode); provider text is never stored here. */
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    modelProvider: text('model_provider'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('runs_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('runs_agent_created_idx').on(table.agentId, table.createdAt),
    uniqueIndex('runs_workspace_idempotency_uq').on(table.workspaceId, table.idempotencyKey),
  ],
);

/**
 * One row per model or tool step. Stores normalized metadata only (route,
 * usage, finish reason, timing, error code) and never hidden reasoning text.
 */
export const runSteps = pgTable(
  'run_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'restrict' }),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    modelProvider: text('model_provider'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    finishReason: text('finish_reason'),
    durationMs: integer('duration_ms'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('run_steps_run_sequence_uq').on(table.runId, table.sequence)],
);

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunStep = typeof runSteps.$inferSelect;
export type NewRunStep = typeof runSteps.$inferInsert;
