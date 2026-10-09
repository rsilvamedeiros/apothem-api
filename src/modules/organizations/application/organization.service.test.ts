import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationService } from './organization.service.js';
import { AuthorizationService } from '../../authorization/application/authorization.service.js';
import type { TenantContext } from '../../authorization/application/tenant-context.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/errors.js';
import {
  FakeAuditLog,
  FakeMembershipRepository,
  FakeOrganizationRepository,
} from '../../../infrastructure/http/__fixtures__/fake-repositories.js';

const principal = { id: 'principal-1', type: 'user', email: 'p1@example.com', name: 'P1' } as const;

describe('OrganizationService', () => {
  let organizations: FakeOrganizationRepository;
  let memberships: FakeMembershipRepository;
  let audit: FakeAuditLog;
  let service: OrganizationService;

  beforeEach(() => {
    memberships = new FakeMembershipRepository();
    organizations = new FakeOrganizationRepository(memberships);
    audit = new FakeAuditLog();
    service = new OrganizationService(organizations, memberships, new AuthorizationService(), audit);
  });

  it('makes the creator an active owner', async () => {
    const organization = await service.create(principal, { name: 'Acme', slug: 'acme' });
    const membership = await memberships.findByPrincipalInOrganization(organization.id, principal.id);
    expect(membership).toMatchObject({ role: 'owner', status: 'active' });
  });

  it('audits the organization and its first membership', async () => {
    const organization = await service.create(principal, { name: 'Acme', slug: 'acme' });
    expect(audit.events.map((event) => event.action)).toEqual(['organization.created', 'membership.created']);
    expect(audit.events[0]).toMatchObject({
      organizationId: organization.id,
      actorPrincipalId: principal.id,
      targetId: organization.id,
      metadata: { slug: 'acme' },
    });
    expect(audit.events[1]?.metadata).toEqual({ principalId: principal.id, role: 'owner' });
    expect(audit.events.map((event) => [event.targetType, event.targetId])).toEqual([
      ['organization', organization.id],
      ['membership', (await memberships.findByPrincipalInOrganization(organization.id, principal.id))!.id],
    ]);
  });

  it('rejects a slug that is already taken without creating a membership or audit event', async () => {
    await service.create(principal, { name: 'Acme', slug: 'acme' });
    const before = audit.events.length;

    const other = { ...principal, id: 'principal-2' };
    await expect(service.create(other, { name: 'Other', slug: 'acme' })).rejects.toThrow('Organization slug "acme" is already in use');

    expect(audit.events).toHaveLength(before);
    expect(await memberships.listByPrincipal(other.id)).toEqual([]);
  });

  describe('creating the organization and its owner together', () => {
    it('leaves no organization behind when the owner membership cannot be stored', async () => {
      vi.spyOn(memberships, 'create').mockRejectedValueOnce(new Error('storage down'));

      await expect(service.create(principal, { name: 'Acme', slug: 'acme' })).rejects.toThrow('storage down');

      expect(await organizations.findBySlug('acme')).toBeUndefined();
      expect(audit.events).toEqual([]);
      // The slug is free again, so the person can simply try again.
      await expect(service.create(principal, { name: 'Acme', slug: 'acme' })).resolves.toMatchObject({ slug: 'acme' });
    });

    it('never stores the organization and the membership separately: one atomic write', async () => {
      const create = vi.spyOn(organizations, 'create');
      const createWithOwner = vi.spyOn(organizations, 'createWithOwner');
      await service.create(principal, { name: 'Acme', slug: 'acme' });
      expect(createWithOwner).toHaveBeenCalledWith({ name: 'Acme', slug: 'acme' }, principal.id);
      expect(create).not.toHaveBeenCalled();
    });

    it('reports a slug taken by a concurrent request as a conflict, not as an internal error', async () => {
      await service.create(principal, { name: 'Acme', slug: 'acme' });
      vi.spyOn(organizations, 'findBySlug').mockResolvedValueOnce(undefined);
      const other = { ...principal, id: 'principal-2' };

      await expect(service.create(other, { name: 'Other', slug: 'acme' })).rejects.toThrow('Organization slug "acme" is already in use');
      await expect(service.create(other, { name: 'Other', slug: 'acme' })).rejects.toThrow('Organization slug "acme" is already in use');
      expect(await memberships.listByPrincipal(other.id)).toEqual([]);
    });

    it('lets an unexpected storage failure through when the slug is not the cause', async () => {
      vi.spyOn(organizations, 'createWithOwner').mockRejectedValueOnce(new Error('storage down'));
      await expect(service.create(principal, { name: 'Acme', slug: 'free-slug' })).rejects.toThrow('storage down');
      expect(audit.events).toEqual([]);
    });
  });

  describe('get', () => {
    const contextFor = (role: TenantContext['organizationRole'], organizationId: string): TenantContext => ({
      principal,
      organizationId,
      organizationRole: role,
    });

    it('returns the organization to any role that can read settings', async () => {
      const organization = await service.create(principal, { name: 'Acme', slug: 'acme' });
      for (const role of ['owner', 'admin', 'builder', 'operator', 'auditor'] as const) {
        await expect(service.get(contextFor(role, organization.id))).resolves.toMatchObject({ id: organization.id });
      }
    });

    it('is not found for a context pointing at a missing organization', async () => {
      await expect(service.get(contextFor('owner', 'missing'))).rejects.toThrow(NotFoundError);
      await expect(service.get(contextFor('owner', 'missing'))).rejects.toThrow('Organization missing not found');
    });

    it('denies a forged role', async () => {
      const organization = await service.create(principal, { name: 'Acme', slug: 'acme' });
      const forged = contextFor('toString' as never, organization.id);
      await expect(service.get(forged)).rejects.toThrow(ForbiddenError);
    });
  });
});
