import { describe, expect, it } from 'vitest';
import { AuthorizationService } from './authorization.service.js';
import type { TenantContext } from './tenant-context.js';
import { CAPABILITIES, type Capability } from '../domain/capability.js';
import { ORGANIZATION_ROLES, type OrganizationRole } from '../domain/role.js';
import { FIXTURE_PRINCIPALS, ORG_A } from './__fixtures__/tenant-fixtures.js';

/**
 * Golden copy of the default RBAC bundles from
 * apothem-ai/docs/01-product/permissions-matrix.md. Any change to
 * ROLE_CAPABILITIES must be a deliberate edit of this table (and the doc),
 * so a permission can never be widened by accident.
 */
const EXPECTED: Record<OrganizationRole, readonly Capability[]> = {
  owner: [
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
  ],
  admin: [
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
  ],
  builder: [
    'organization.settings.read',
    'workspace.membership.read',
    'agent.read',
    'agent.draft.write',
    'knowledge.manage',
    'knowledge.use',
    'agent.run',
    'run.read',
  ],
  operator: [
    'organization.settings.read',
    'workspace.membership.read',
    'agent.read',
    'knowledge.use',
    'agent.run',
    'run.read',
  ],
  auditor: [
    'organization.settings.read',
    'organization.billing.read',
    'workspace.membership.read',
    'agent.read',
    'audit.read',
    'run.read',
  ],
};

function contextFor(role: OrganizationRole): TenantContext {
  return { principal: FIXTURE_PRINCIPALS.ownerA, organizationId: ORG_A, organizationRole: role };
}

describe('permission matrix (golden)', () => {
  const service = new AuthorizationService();

  for (const role of ORGANIZATION_ROLES) {
    describe(role, () => {
      for (const capability of CAPABILITIES) {
        const allowed = EXPECTED[role].includes(capability);
        it(`${allowed ? 'grants' : 'denies'} ${capability}`, () => {
          expect(service.can(contextFor(role), capability)).toBe(allowed);
        });
      }
    });
  }

  it('grants approval.decide to no default role (it is policy-driven, never a blanket grant)', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(service.can(contextFor(role), 'approval.decide')).toBe(false);
    }
  });
});
