import { pgTable, text, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core';

export const principalTypeEnum = pgEnum('principal_type', ['user', 'service_account']);
export const principalStatusEnum = pgEnum('principal_status', ['active', 'suspended']);

/**
 * Identity/principal only — no organization membership or role here.
 * See src/modules/organizations/infrastructure/schema.ts for membership.
 */
export const principals = pgTable('principals', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: principalTypeEnum('type').notNull().default('user'),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  status: principalStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Principal = typeof principals.$inferSelect;
export type NewPrincipal = typeof principals.$inferInsert;
