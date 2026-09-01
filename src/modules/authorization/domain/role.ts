import type { Capability } from './capability.js';

/** Kept in sync with the organization_role enum in organizations/infrastructure/schema.ts. */
export const ORGANIZATION_ROLES = ['owner', 'admin', 'builder', 'operator', 'auditor'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/**
 * Default RBAC bundles from apothem-ai/docs/01-product/permissions-matrix.md.
 * "policy"/"configurable"/"limited"/"scoped" cells from that matrix are
 * resolved conservatively here (granted only where the matrix says an
 * unconditional ✓); anything conditional is left for a later attribute/policy
 * layer rather than guessed into a blanket grant.
 */
export const ROLE_CAPABILITIES: Readonly<Record<OrganizationRole, ReadonlySet<Capability>>> = {
  owner: new Set<Capability>([
    'organization.settings.manage',
    'organization.settings.read',
    'organization.billing.manage',
    'organization.billing.read',
    'workspace.membership.manage',
    'workspace.membership.read',
    'agent.read',
    'agent.draft.write',
    'agent.publish',
    'knowledge.manage',
    'knowledge.use',
    'connection.manage',
    'agent.run',
    'run.read',
    'audit.read',
    'apikey.manage',
  ]),
  admin: new Set<Capability>([
    'organization.settings.read',
    'organization.billing.read',
    'workspace.membership.manage',
    'workspace.membership.read',
    'agent.read',
    'agent.draft.write',
    'agent.publish',
    'knowledge.manage',
    'knowledge.use',
    'connection.manage',
    'agent.run',
    'run.read',
    'audit.read',
    'apikey.manage',
  ]),
  builder: new Set<Capability>([
    'organization.settings.read',
    'workspace.membership.read',
    'agent.read',
    'agent.draft.write',
    'knowledge.manage',
    'knowledge.use',
    'agent.run',
    'run.read',
  ]),
  operator: new Set<Capability>([
    'organization.settings.read',
    'workspace.membership.read',
    'agent.read',
    'knowledge.use',
    'agent.run',
    'run.read',
  ]),
  auditor: new Set<Capability>([
    'organization.settings.read',
    'organization.billing.read',
    'workspace.membership.read',
    'agent.read',
    'audit.read',
    'run.read',
  ]),
};
