import { pgTable, text, timestamp, uuid, pgEnum, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { principals } from '../../identity/infrastructure/schema.js';

export const organizationStatusEnum = pgEnum('organization_status', [
  'active',
  'suspended',
  'pending_deletion',
]);

export const organizationRoleEnum = pgEnum('organization_role', ['owner', 'admin', 'member']);
export const membershipStatusEnum = pgEnum('membership_status', [
  'active',
  'invited',
  'revoked',
]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: organizationStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Organization-level membership. Workspace-scoped role narrowing lives in
 * src/modules/workspaces/infrastructure/schema.ts (workspaceMemberships).
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    role: organizationRoleEnum('role').notNull().default('member'),
    status: membershipStatusEnum('status').notNull().default('active'),
    settings: jsonb('settings'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('memberships_org_principal_uq').on(table.organizationId, table.principalId)],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
