import { ORGANIZATION_ROLES, type OrganizationRole } from './role.js';

/**
 * Who may grant or change which role. Holding `workspace.membership.manage`
 * is necessary but not sufficient: an actor can only hand out roles strictly
 * below their own, except owners who can assign any role. This stops an admin
 * from promoting themselves or an accomplice to owner.
 */
const ASSIGNABLE_BY: Readonly<Record<OrganizationRole, readonly OrganizationRole[]>> = {
  owner: ['owner', 'admin', 'builder', 'operator', 'auditor'],
  admin: ['builder', 'operator', 'auditor'],
  builder: [],
  operator: [],
  auditor: [],
};

export function assignableRoles(actorRole: OrganizationRole): readonly OrganizationRole[] {
  // hasOwn guards against inherited keys such as "toString".
  return Object.hasOwn(ASSIGNABLE_BY, actorRole) ? ASSIGNABLE_BY[actorRole] : [];
}

export function canAssignRole(actorRole: OrganizationRole, targetRole: OrganizationRole): boolean {
  return (ORGANIZATION_ROLES as readonly string[]).includes(targetRole) && assignableRoles(actorRole).includes(targetRole);
}
