/**
 * Aggregates every module's schema for drizzle-kit migration generation and
 * for the drizzle client's relational query builder. Modules must not import
 * this barrel — they own their own schema file and repositories import it
 * directly to avoid circular/cross-module coupling.
 */
export * from '../../modules/identity/infrastructure/schema.js';
export * from '../../modules/organizations/infrastructure/schema.js';
export * from '../../modules/workspaces/infrastructure/schema.js';
export * from '../../modules/audit/infrastructure/schema.js';
export * from '../../modules/agents/infrastructure/schema.js';
