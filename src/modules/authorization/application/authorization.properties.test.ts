import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AuthorizationService } from './authorization.service.js';
import type { TenantContext } from './tenant-context.js';
import { CAPABILITIES, isOrganizationScoped } from '../domain/capability.js';
import { ORGANIZATION_ROLES, ROLE_CAPABILITIES } from '../domain/role.js';
import { FIXTURE_PRINCIPALS } from './__fixtures__/tenant-fixtures.js';

const roleArb = fc.constantFrom(...ORGANIZATION_ROLES);
const capabilityArb = fc.constantFrom(...CAPABILITIES);

const contextArb: fc.Arbitrary<TenantContext> = fc
  .record({
    organizationId: fc.uuid(),
    organizationRole: roleArb,
    workspaceId: fc.option(fc.uuid(), { nil: undefined }),
    workspaceRole: fc.option(roleArb, { nil: undefined }),
  })
  .map(({ workspaceId, workspaceRole, ...rest }) => ({
    principal: FIXTURE_PRINCIPALS.ownerA,
    ...rest,
    ...(workspaceId ? { workspaceId } : {}),
    ...(workspaceId && workspaceRole ? { workspaceRole } : {}),
  }));

describe('AuthorizationService (properties)', () => {
  const service = new AuthorizationService();

  it('is deterministic for the same context and capability', () => {
    fc.assert(
      fc.property(contextArb, capabilityArb, (context, capability) => {
        expect(service.can(context, capability)).toBe(service.can(context, capability));
      }),
    );
  });

  it('denies every capability that is not in the known capability list (deny by default)', () => {
    fc.assert(
      fc.property(
        contextArb,
        fc.string().filter((value) => !(CAPABILITIES as readonly string[]).includes(value)),
        (context, unknown) => {
          expect(service.can(context, unknown as never)).toBe(false);
        },
      ),
    );
  });

  it('denies every capability for a role that has no bundle (fails closed)', () => {
    fc.assert(
      fc.property(
        contextArb,
        fc.string().filter((value) => !(ORGANIZATION_ROLES as readonly string[]).includes(value)),
        capabilityArb,
        (context, role, capability) => {
          const forged = { ...context, organizationRole: role, workspaceRole: undefined } as unknown as TenantContext;
          expect(service.can(forged, capability)).toBe(false);
        },
      ),
    );
  });

  it('only ever grants capabilities that belong to the effective role bundle', () => {
    fc.assert(
      fc.property(contextArb, capabilityArb, (context, capability) => {
        if (service.can(context, capability)) {
          const role = isOrganizationScoped(capability)
            ? context.organizationRole
            : (context.workspaceRole ?? context.organizationRole);
          expect(ROLE_CAPABILITIES[role].has(capability)).toBe(true);
        }
      }),
    );
  });

  it('never lets a workspace role change the outcome of an organization-scoped capability', () => {
    fc.assert(
      fc.property(contextArb, capabilityArb, (context, capability) => {
        fc.pre(isOrganizationScoped(capability));
        const { workspaceRole: _ignored, ...withoutOverride } = context;
        expect(service.can(context, capability)).toBe(service.can(withoutOverride, capability));
      }),
    );
  });

  it('assert throws exactly when can is false', () => {
    fc.assert(
      fc.property(contextArb, capabilityArb, (context, capability) => {
        const allowed = service.can(context, capability);
        if (allowed) {
          expect(() => service.assert(context, capability)).not.toThrow();
        } else {
          expect(() => service.assert(context, capability)).toThrow();
        }
      }),
    );
  });
});

describe('role bundles (properties)', () => {
  it('only reference declared capabilities', () => {
    for (const role of ORGANIZATION_ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        expect(CAPABILITIES).toContain(capability);
      }
    }
  });

  it('keep the privilege ladder owner ⊇ admin ⊇ builder ⊇ operator', () => {
    const ladder = ['owner', 'admin', 'builder', 'operator'] as const;
    for (let index = 0; index < ladder.length - 1; index += 1) {
      const higher = ROLE_CAPABILITIES[ladder[index]!];
      const lower = ROLE_CAPABILITIES[ladder[index + 1]!];
      for (const capability of lower) {
        expect(higher.has(capability)).toBe(true);
      }
    }
  });

  it('never let the auditor write or run anything', () => {
    const forbidden = ['agent.draft.write', 'agent.publish', 'agent.run', 'knowledge.manage', 'connection.manage', 'apikey.manage', 'policy.manage'] as const;
    for (const capability of forbidden) {
      expect(ROLE_CAPABILITIES.auditor.has(capability)).toBe(false);
    }
  });
});
