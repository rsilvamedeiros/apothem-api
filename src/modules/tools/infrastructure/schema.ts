import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '../../organizations/infrastructure/schema.js';
import { workspaces } from '../../workspaces/infrastructure/schema.js';

/**
 * Notes written by the built-in `create_note` tool (reversible write). They
 * are soft deleted so a mistaken or rejected-later action can be undone
 * without losing the record of what happened.
 */
export const workspaceNotes = pgTable(
  'workspace_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdByPrincipalId: uuid('created_by_principal_id').notNull(),
    /** Makes tool execution idempotent: the same key never creates a second note. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdByRunId: uuid('created_by_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('workspace_notes_workspace_created_idx').on(table.workspaceId, table.createdAt),
    uniqueIndex('workspace_notes_idempotency_uq').on(table.workspaceId, table.idempotencyKey),
  ],
);

export type WorkspaceNote = typeof workspaceNotes.$inferSelect;
export type NewWorkspaceNote = typeof workspaceNotes.$inferInsert;

export const workspaceToolRuleEnum = pgEnum('workspace_tool_rule', ['blocked', 'approval_required']);

/**
 * A workspace rule for one catalog tool (ADR-015). It is a ceiling set by an
 * owner or admin: it can block a tool or force approval, never enable or
 * relax anything. No row means no rule.
 */
export const toolPolicies = pgTable(
  'tool_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    toolName: text('tool_name').notNull(),
    rule: workspaceToolRuleEnum('rule').notNull(),
    updatedByPrincipalId: uuid('updated_by_principal_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tool_policies_workspace_tool_uq').on(table.workspaceId, table.toolName)],
);

export type ToolPolicy = typeof toolPolicies.$inferSelect;
export type NewToolPolicy = typeof toolPolicies.$inferInsert;
