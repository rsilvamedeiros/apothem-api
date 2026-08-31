import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core';

/**
 * Append-only. No update/delete repository methods are exposed — audit
 * records must survive resource archival per executions-audit.md.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    workspaceId: uuid('workspace_id'),
    actorPrincipalId: uuid('actor_principal_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_events_org_created_idx').on(table.organizationId, table.createdAt)],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
