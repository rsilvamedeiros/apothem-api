import { beforeEach, describe, expect, it } from 'vitest';
import { MemberService } from './member.service.js';
import { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import type { OrganizationRole } from '../../authorization/domain/role.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/errors.js';
import {
  FakeAuditLog,
  FakeMembershipRepository,
  FakePrincipalRepository,
} from '../../../infrastructure/http/__fixtures__/fake-repositories.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';

describe('MemberService', () => {
  let principals: FakePrincipalRepository;
  let memberships: FakeMembershipRepository;
  let audit: FakeAuditLog;
  let service: MemberService;

  beforeEach(() => {
    principals = new FakePrincipalRepository();
    memberships = new FakeMembershipRepository();
    audit = new FakeAuditLog();
    service = new MemberService(memberships, principals, new AuthorizationService(), audit);
  });

  async function member(label: string, role: OrganizationRole, organizationId = ORG, status: 'active' | 'invited' | 'revoked' = 'active') {
    const principal = await principals.create({ type: 'user', email: `${label}@example.com`, name: label });
    const membership = await memberships.create({ organizationId, principalId: principal.id, role, status });
    return { principal, membership };
  }

  const contextOf = (actor: { principal: { id: string; email: string; name: string } }, role: OrganizationRole, organizationId = ORG): TenantContext => ({
    principal: { id: actor.principal.id, type: 'user', email: actor.principal.email, name: actor.principal.name },
    organizationId,
    organizationRole: role,
  });

  describe('list', () => {
    it('shows members of the organization with their account details', async () => {
      const owner = await member('owner', 'owner');
      await member('stranger', 'owner', OTHER_ORG);
      const list = await service.list(contextOf(owner, 'owner'));
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ email: 'owner@example.com', role: 'owner', status: 'active', principalId: owner.principal.id });
    });

    it.each(['owner', 'admin', 'builder', 'operator', 'auditor'] as const)('lets %s read the member list', async (role) => {
      const actor = await member(role, role);
      await expect(service.list(contextOf(actor, role))).resolves.toHaveLength(1);
    });
  });

  describe('add', () => {
    it('adds an existing account with a role the actor may assign, and audits it', async () => {
      const admin = await member('admin', 'admin');
      await principals.create({ type: 'user', email: 'new@example.com', name: 'New' });

      const added = await service.add(contextOf(admin, 'admin'), { email: 'New@Example.com ', role: 'builder' });
      expect(added).toMatchObject({ email: 'new@example.com', role: 'builder', status: 'active' });
      expect(audit.events.at(-1)).toMatchObject({
        action: 'membership.created',
        organizationId: ORG,
        actorPrincipalId: admin.principal.id,
        metadata: { principalId: added.principalId, role: 'builder' },
      });
    });

    it('stops an admin from creating admins or owners (privilege escalation)', async () => {
      const admin = await member('admin', 'admin');
      await principals.create({ type: 'user', email: 'friend@example.com', name: 'Friend' });
      for (const role of ['admin', 'owner'] as const) {
        await expect(service.add(contextOf(admin, 'admin'), { email: 'friend@example.com', role })).rejects.toThrow(ForbiddenError);
      }
      expect(audit.events).toHaveLength(0);
    });

    it('lets an owner create admins and owners', async () => {
      const owner = await member('owner', 'owner');
      await principals.create({ type: 'user', email: 'a@example.com', name: 'A' });
      await principals.create({ type: 'user', email: 'b@example.com', name: 'B' });
      await expect(service.add(contextOf(owner, 'owner'), { email: 'a@example.com', role: 'admin' })).resolves.toBeDefined();
      await expect(service.add(contextOf(owner, 'owner'), { email: 'b@example.com', role: 'owner' })).resolves.toBeDefined();
    });

    it.each(['builder', 'operator', 'auditor'] as const)('denies %s managing members', async (role) => {
      const actor = await member(role, role);
      await principals.create({ type: 'user', email: 'x@example.com', name: 'X' });
      await expect(service.add(contextOf(actor, role), { email: 'x@example.com', role: 'operator' })).rejects.toThrow(ForbiddenError);
    });

    it('ignores a workspace role override when checking who may assign roles', async () => {
      const operator = await member('operator', 'operator');
      await principals.create({ type: 'user', email: 'x@example.com', name: 'X' });
      const context: TenantContext = { ...contextOf(operator, 'operator'), workspaceId: 'w', workspaceRole: 'owner' };
      await expect(service.add(context, { email: 'x@example.com', role: 'owner' })).rejects.toThrow(ForbiddenError);
    });

    it('reports an unknown or suspended account the same way', async () => {
      const owner = await member('owner', 'owner');
      const suspended = await principals.create({ type: 'user', email: 's@example.com', name: 'S' });
      suspended.status = 'suspended';
      const unknown = await service.add(contextOf(owner, 'owner'), { email: 'nobody@example.com', role: 'operator' }).catch((e: Error) => e);
      const susp = await service.add(contextOf(owner, 'owner'), { email: 's@example.com', role: 'operator' }).catch((e: Error) => e);
      expect(unknown).toBeInstanceOf(NotFoundError);
      expect(susp).toBeInstanceOf(NotFoundError);
      expect((susp as Error).message).toBe((unknown as Error).message);
    });

    it('rejects someone who is already an active or invited member', async () => {
      const owner = await member('owner', 'owner');
      await member('dup', 'operator');
      await member('pending', 'operator', ORG, 'invited');
      await expect(service.add(contextOf(owner, 'owner'), { email: 'dup@example.com', role: 'builder' })).rejects.toThrow(ConflictError);
      await expect(service.add(contextOf(owner, 'owner'), { email: 'pending@example.com', role: 'builder' })).rejects.toThrow(ConflictError);
    });

    it('reactivates a revoked membership with the new role instead of duplicating it', async () => {
      const owner = await member('owner', 'owner');
      const former = await member('former', 'admin', ORG, 'revoked');
      const added = await service.add(contextOf(owner, 'owner'), { email: 'former@example.com', role: 'auditor' });
      expect(added.membershipId).toBe(former.membership.id);
      expect(added).toMatchObject({ role: 'auditor', status: 'active' });
      expect(await memberships.listByOrganization(ORG)).toHaveLength(2);
      expect(audit.events.at(-1)?.action).toBe('membership.reactivated');
    });

    it('can add the same account to a different organization independently', async () => {
      const owner = await member('owner', 'owner');
      await member('shared', 'operator', OTHER_ORG);
      await expect(service.add(contextOf(owner, 'owner'), { email: 'shared@example.com', role: 'builder' })).resolves.toBeDefined();
    });
  });

  describe('changeRole', () => {
    it('changes a role within the actor limits and audits from and to', async () => {
      const admin = await member('admin', 'admin');
      const target = await member('target', 'operator');
      const updated = await service.changeRole(contextOf(admin, 'admin'), target.membership.id, 'builder');
      expect(updated.role).toBe('builder');
      expect(audit.events.at(-1)).toMatchObject({
        action: 'membership.role_changed',
        targetId: target.membership.id,
        metadata: { principalId: target.principal.id, from: 'operator', to: 'builder' },
      });
    });

    it('stops an admin from promoting anyone to admin or owner, including themselves', async () => {
      const admin = await member('admin', 'admin');
      const target = await member('target', 'operator');
      await expect(service.changeRole(contextOf(admin, 'admin'), target.membership.id, 'admin')).rejects.toThrow(ForbiddenError);
      await expect(service.changeRole(contextOf(admin, 'admin'), admin.membership.id, 'owner')).rejects.toThrow(ForbiddenError);
    });

    it('stops an admin from touching an owner or another admin', async () => {
      const admin = await member('admin', 'admin');
      const owner = await member('owner', 'owner');
      const peer = await member('peer', 'admin');
      await expect(service.changeRole(contextOf(admin, 'admin'), owner.membership.id, 'operator')).rejects.toThrow(ForbiddenError);
      await expect(service.changeRole(contextOf(admin, 'admin'), peer.membership.id, 'operator')).rejects.toThrow(ForbiddenError);
    });

    it('never demotes the last active owner, but allows it when another owner exists', async () => {
      const owner = await member('owner', 'owner');
      await expect(service.changeRole(contextOf(owner, 'owner'), owner.membership.id, 'admin')).rejects.toThrow(ConflictError);

      const second = await member('second', 'owner');
      await expect(service.changeRole(contextOf(owner, 'owner'), second.membership.id, 'admin')).resolves.toMatchObject({ role: 'admin' });
      // Now owner is the only one again.
      await expect(service.changeRole(contextOf(owner, 'owner'), owner.membership.id, 'admin')).rejects.toThrow(ConflictError);
    });

    it('does not count revoked or invited owners when protecting the last owner', async () => {
      const owner = await member('owner', 'owner');
      await member('ghost', 'owner', ORG, 'revoked');
      await member('pending', 'owner', ORG, 'invited');
      await expect(service.changeRole(contextOf(owner, 'owner'), owner.membership.id, 'builder')).rejects.toThrow(ConflictError);
    });

    it('is not found for a membership of another organization (no cross-tenant probing)', async () => {
      const owner = await member('owner', 'owner');
      const foreign = await member('foreign', 'operator', OTHER_ORG);
      await expect(service.changeRole(contextOf(owner, 'owner'), foreign.membership.id, 'builder')).rejects.toThrow(NotFoundError);
      expect((await memberships.findById(OTHER_ORG, foreign.membership.id))?.role).toBe('operator');
    });

    it('refuses to change a revoked membership and does nothing for an identical role', async () => {
      const owner = await member('owner', 'owner');
      const revoked = await member('gone', 'operator', ORG, 'revoked');
      const same = await member('same', 'operator');
      await expect(service.changeRole(contextOf(owner, 'owner'), revoked.membership.id, 'builder')).rejects.toThrow(ConflictError);

      const before = audit.events.length;
      await expect(service.changeRole(contextOf(owner, 'owner'), same.membership.id, 'operator')).resolves.toMatchObject({ role: 'operator' });
      expect(audit.events).toHaveLength(before);
    });

    it.each(['builder', 'operator', 'auditor'] as const)('denies %s', async (role) => {
      const actor = await member(role, role);
      const target = await member('target', 'operator');
      await expect(service.changeRole(contextOf(actor, role), target.membership.id, 'auditor')).rejects.toThrow(ForbiddenError);
    });
  });

  describe('revoke', () => {
    it('revokes access, keeps the row for history, and audits it', async () => {
      const admin = await member('admin', 'admin');
      const target = await member('target', 'operator');
      const revoked = await service.revoke(contextOf(admin, 'admin'), target.membership.id);
      expect(revoked.status).toBe('revoked');
      expect((await memberships.findById(ORG, target.membership.id))?.status).toBe('revoked');
      expect(audit.events.at(-1)).toMatchObject({
        action: 'membership.revoked',
        targetId: target.membership.id,
        metadata: { principalId: target.principal.id, role: 'operator' },
      });
    });

    it('never revokes the last active owner', async () => {
      const owner = await member('owner', 'owner');
      await expect(service.revoke(contextOf(owner, 'owner'), owner.membership.id)).rejects.toThrow(ConflictError);
      expect((await memberships.findById(ORG, owner.membership.id))?.status).toBe('active');
    });

    it('stops an admin from revoking an owner or a peer admin', async () => {
      const admin = await member('admin', 'admin');
      const owner = await member('owner', 'owner');
      const peer = await member('peer', 'admin');
      await expect(service.revoke(contextOf(admin, 'admin'), owner.membership.id)).rejects.toThrow(ForbiddenError);
      await expect(service.revoke(contextOf(admin, 'admin'), peer.membership.id)).rejects.toThrow(ForbiddenError);
    });

    it('rejects revoking twice and foreign memberships', async () => {
      const owner = await member('owner', 'owner');
      const target = await member('target', 'operator');
      await service.revoke(contextOf(owner, 'owner'), target.membership.id);
      await expect(service.revoke(contextOf(owner, 'owner'), target.membership.id)).rejects.toThrow(ConflictError);
      const foreign = await member('foreign', 'operator', OTHER_ORG);
      await expect(service.revoke(contextOf(owner, 'owner'), foreign.membership.id)).rejects.toThrow(NotFoundError);
    });

    it('denies roles without membership management and audits nothing', async () => {
      const builder = await member('builder', 'builder');
      const target = await member('target', 'operator');
      await expect(service.revoke(contextOf(builder, 'builder'), target.membership.id)).rejects.toThrow(ForbiddenError);
      expect(audit.events).toHaveLength(0);
    });
  });
});
