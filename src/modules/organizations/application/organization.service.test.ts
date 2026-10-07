import { beforeEach, describe, expect, it } from 'vitest';
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
    organizations = new FakeOrganizationRepository();
    memberships = new FakeMembershipRepository();
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
  });

  it('rejects a slug that is already taken without creating a membership or audit event', async () => {
    await service.create(principal, { name: 'Acme', slug: 'acme' });
    const before = audit.events.length;

    const other = { ...principal, id: 'principal-2' };
    await expect(service.create(other, { name: 'Other', slug: 'acme' })).rejects.toThrow(ConflictError);

    expect(audit.events).toHaveLength(before);
    expect(await memberships.listByPrincipal(other.id)).toEqual([]);
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
    });

    it('denies a forged role', async () => {
      const organization = await service.create(principal, { name: 'Acme', slug: 'acme' });
      const forged = contextFor('toString' as never, organization.id);
      await expect(service.get(forged)).rejects.toThrow(ForbiddenError);
    });
  });
});
