import { pgTable, text, timestamp, uuid, pgEnum, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { organizations, memberships, organizationRoleEnum } from '../../organizations/infrastructure/schema.js';

export const workspaceStatusEnum = pgEnum('workspace_status', ['active', 'archived']);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: workspaceStatusEnum('status').notNull().default('active'),
    settings: jsonb('settings'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('workspaces_org_slug_uq').on(table.organizationId, table.slug)],
);

/**
 * Narrows an existing organization membership to a specific workspace.
 * Role defaults to the organization-level role but can be overridden per workspace.
 */
export const workspaceMemberships = pgTable(
  'workspace_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    role: organizationRoleEnum('role'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('workspace_memberships_ws_membership_uq').on(table.workspaceId, table.membershipId)],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMembership = typeof workspaceMemberships.$inferSelect;
export type NewWorkspaceMembership = typeof workspaceMemberships.$inferInsert;
