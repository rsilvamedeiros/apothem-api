import type { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import { canAssignRole } from '../../authorization/domain/role-assignment.js';
import type { OrganizationRole } from '../../authorization/domain/role.js';
import type { AuditPort } from '../../audit/application/audit.port.js';
import type { PrincipalPort } from '../../identity/application/principal.port.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/errors.js';
import type { MembershipPort } from './membership.port.js';
import type { Membership } from '../infrastructure/schema.js';

export interface MemberView {
  readonly membershipId: string;
  readonly principalId: string;
  readonly email: string;
  readonly name: string;
  readonly role: OrganizationRole;
  readonly status: Membership['status'];
  readonly createdAt: Date;
}

export interface AddMemberInput {
  email: string;
  role: OrganizationRole;
}

/** Same message for "no such account" and "suspended account" so the answer reveals nothing extra. */
const NO_ACTIVE_ACCOUNT = 'No active account found for that email';

/**
 * Organization membership management. `workspace.membership.manage` is
 * necessary but not sufficient: the actor's *organization* role also bounds
 * which roles they may grant, change or revoke (see role-assignment.ts), and
 * the last active owner can never be demoted or removed.
 */
export class MemberService {
  constructor(
    private readonly memberships: MembershipPort,
    private readonly principals: PrincipalPort,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditPort,
  ) {}

  async list(context: TenantContext): Promise<MemberView[]> {
    this.authorization.assert(context, 'workspace.membership.read');
    const rows = await this.memberships.listByOrganization(context.organizationId);
    const accounts = await this.principals.findManyByIds(rows.map((row) => row.principalId));
    const byId = new Map(accounts.map((account) => [account.id, account]));

    return rows.flatMap((row) => {
      const account = byId.get(row.principalId);
      return account ? [toView(row, account.email, account.name)] : [];
    });
  }

  async add(context: TenantContext, input: AddMemberInput): Promise<MemberView> {
    this.authorization.assert(context, 'workspace.membership.manage');
    this.assertMayAssign(context, input.role);

    const account = await this.principals.findByEmail(input.email.trim().toLowerCase());
    if (!account || account.status !== 'active') {
      throw new NotFoundError(NO_ACTIVE_ACCOUNT);
    }

    const existing = await this.memberships.findByPrincipalInOrganization(context.organizationId, account.id);
    if (existing && existing.status !== 'revoked') {
      throw new ConflictError('This account is already a member of the organization');
    }

    const reactivated = existing !== undefined;
    const membership = existing
      ? await this.memberships.update(context.organizationId, existing.id, { role: input.role, status: 'active' })
      : await this.memberships.create({
          organizationId: context.organizationId,
          principalId: account.id,
          role: input.role,
          status: 'active',
        });

    await this.audit.record({
      organizationId: context.organizationId,
      actorPrincipalId: context.principal.id,
      action: reactivated ? 'membership.reactivated' : 'membership.created',
      targetType: 'membership',
      targetId: membership.id,
      metadata: { principalId: account.id, role: membership.role },
    });

    return toView(membership, account.email, account.name);
  }

  async changeRole(context: TenantContext, membershipId: string, role: OrganizationRole): Promise<MemberView> {
    this.authorization.assert(context, 'workspace.membership.manage');
    const target = await this.requireMembership(context, membershipId);
    if (target.status !== 'active') {
      throw new ConflictError('Only active memberships can change role');
    }
    // The actor must be allowed to hand out the new role AND to touch the current one.
    this.assertMayAssign(context, role);
    this.assertMayAssign(context, target.role);

    if (role === target.role) {
      return this.view(target);
    }
    await this.assertNotLastOwner(context, target);

    // Captured before the write so the audit record never depends on whether the store mutates in place.
    const previousRole = target.role;
    const updated = await this.memberships.update(context.organizationId, target.id, { role });
    await this.audit.record({
      organizationId: context.organizationId,
      actorPrincipalId: context.principal.id,
      action: 'membership.role_changed',
      targetType: 'membership',
      targetId: target.id,
      metadata: { principalId: target.principalId, from: previousRole, to: role },
    });
    return this.view(updated);
  }

  async revoke(context: TenantContext, membershipId: string): Promise<MemberView> {
    this.authorization.assert(context, 'workspace.membership.manage');
    const target = await this.requireMembership(context, membershipId);
    if (target.status === 'revoked') {
      throw new ConflictError('This membership is already revoked');
    }
    this.assertMayAssign(context, target.role);
    await this.assertNotLastOwner(context, target);

    const previousRole = target.role;
    const updated = await this.memberships.update(context.organizationId, target.id, { status: 'revoked' });
    await this.audit.record({
      organizationId: context.organizationId,
      actorPrincipalId: context.principal.id,
      action: 'membership.revoked',
      targetType: 'membership',
      targetId: target.id,
      metadata: { principalId: target.principalId, role: previousRole },
    });
    return this.view(updated);
  }

  /** Uses the organization role only: a workspace role never widens who may manage members. */
  private assertMayAssign(context: TenantContext, role: OrganizationRole): void {
    if (!canAssignRole(context.organizationRole, role)) {
      throw new ForbiddenError(`Your role cannot grant, change or remove the "${role}" role`);
    }
  }

  private async requireMembership(context: TenantContext, membershipId: string): Promise<Membership> {
    // Scoped by organization: a foreign membership id is indistinguishable from a missing one.
    const membership = await this.memberships.findById(context.organizationId, membershipId);
    if (!membership) {
      throw new NotFoundError(`Membership ${membershipId} not found`);
    }
    return membership;
  }

  private async assertNotLastOwner(context: TenantContext, target: Membership): Promise<void> {
    if (target.role !== 'owner' || target.status !== 'active') {
      return;
    }
    const all = await this.memberships.listByOrganization(context.organizationId);
    const activeOwners = all.filter((row) => row.role === 'owner' && row.status === 'active');
    if (activeOwners.length <= 1) {
      throw new ConflictError('An organization must keep at least one active owner');
    }
  }

  private async view(membership: Membership): Promise<MemberView> {
    const [account] = await this.principals.findManyByIds([membership.principalId]);
    return toView(membership, account?.email ?? '', account?.name ?? '');
  }
}

function toView(membership: Membership, email: string, name: string): MemberView {
  return {
    membershipId: membership.id,
    principalId: membership.principalId,
    email,
    name,
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt,
  };
}
