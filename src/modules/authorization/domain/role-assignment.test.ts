import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assignableRoles, canAssignRole } from './role-assignment.js';
import { ORGANIZATION_ROLES, type OrganizationRole } from './role.js';

const roleArb = fc.constantFrom(...ORGANIZATION_ROLES);

describe('role assignment policy', () => {
  it('lets an owner assign every role', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(canAssignRole('owner', role)).toBe(true);
    }
  });

  it('lets an admin assign only roles below admin', () => {
    expect([...assignableRoles('admin')].sort()).toEqual(['auditor', 'builder', 'operator']);
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'owner')).toBe(false);
  });

  it.each(['builder', 'operator', 'auditor'] as const)('lets %s assign nothing', (actor) => {
    expect(assignableRoles(actor)).toEqual([]);
    for (const target of ORGANIZATION_ROLES) {
      expect(canAssignRole(actor, target)).toBe(false);
    }
  });

  it('never allows privilege escalation: nobody but an owner can create an owner or an admin (property)', () => {
    fc.assert(
      fc.property(roleArb, roleArb, (actor, target) => {
        if (canAssignRole(actor, target) && (target === 'owner' || target === 'admin')) {
          expect(actor).toBe('owner');
        }
      }),
    );
  });

  it('denies forged role names instead of throwing', () => {
    for (const forged of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(canAssignRole(forged as OrganizationRole, 'operator')).toBe(false);
      expect(canAssignRole('owner', forged as OrganizationRole)).toBe(false);
    }
  });

  it('is consistent between canAssignRole and assignableRoles (property)', () => {
    fc.assert(
      fc.property(roleArb, roleArb, (actor, target) => {
        expect(canAssignRole(actor, target)).toBe(assignableRoles(actor).includes(target));
      }),
    );
  });
});
