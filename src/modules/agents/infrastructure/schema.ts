import { pgTable, text, timestamp, uuid, pgEnum, uniqueIndex, jsonb, integer } from 'drizzle-orm/pg-core';
import { organizations } from '../../organizations/infrastructure/schema.js';
import { workspaces } from '../../workspaces/infrastructure/schema.js';

/** DRAFT/INACTIVE -> ACTIVE -> DISABLED -> ARCHIVED, per domain-model.md. Publishing does not change status by itself except the first publish (draft -> active). */
export const agentStatusEnum = pgEnum('agent_status', ['draft', 'active', 'disabled', 'archived']);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    status: agentStatusEnum('status').notNull().default('draft'),
    // Set on first publish and updated by later publishes/rollbacks; never
    // implies the referenced agent_versions row can be mutated.
    activeVersionId: uuid('active_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('agents_workspace_slug_uq').on(table.workspaceId, table.slug)],
);

/**
 * One mutable row per agent — the "current draft pointer" from agents.md.
 * Editing this never affects a previously published agent_versions row.
 */
export const agentDrafts = pgTable('agent_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .unique()
    .references(() => agents.id, { onDelete: 'cascade' }),
  instructions: text('instructions').notNull().default(''),
  // Opaque/variable payloads until the Model Gateway (ADR-004) and
  // knowledge/connect modules exist to give them a typed contract — see
  // database-design.md JSONB guidance.
  modelPolicy: jsonb('model_policy').notNull().default({}),
  knowledgeBindings: jsonb('knowledge_bindings').notNull().default([]),
  toolBindings: jsonb('tool_bindings').notNull().default([]),
  memoryPolicy: jsonb('memory_policy').notNull().default({}),
  guardrails: jsonb('guardrails').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Immutable publication snapshot — see agents.md. No repository update/delete
 * method is ever exposed for this table.
 */
export const agentVersions = pgTable(
  'agent_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    instructions: text('instructions').notNull(),
    modelPolicy: jsonb('model_policy').notNull(),
    knowledgeBindings: jsonb('knowledge_bindings').notNull(),
    toolBindings: jsonb('tool_bindings').notNull(),
    memoryPolicy: jsonb('memory_policy').notNull(),
    guardrails: jsonb('guardrails').notNull(),
    checksum: text('checksum').notNull(),
    publishedByPrincipalId: uuid('published_by_principal_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('agent_versions_agent_version_uq').on(table.agentId, table.versionNumber)],
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type AgentDraft = typeof agentDrafts.$inferSelect;
export type NewAgentDraft = typeof agentDrafts.$inferInsert;
export type AgentVersion = typeof agentVersions.$inferSelect;
export type NewAgentVersion = typeof agentVersions.$inferInsert;
