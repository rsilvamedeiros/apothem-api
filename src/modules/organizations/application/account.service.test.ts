import { beforeEach, describe, expect, it } from 'vitest';
import { AccountService } from './account.service.js';
import {
  FakeMembershipRepository,
  FakeOrganizationRepository,
} from '../../../infrastructure/http/__fixtures__/fake-repositories.js';

const alice = { id: 'principal-alice', type: 'user', email: 'alice@example.com', name: 'Alice' } as const;
const bob = { id: 'principal-bob', type: 'user', email: 'bob@example.com', name: 'Bob' } as const;

describe('AccountService', () => {
  let organizations: FakeOrganizationRepository;
  let memberships: FakeMembershipRepository;
  let service: AccountService;

  beforeEach(() => {
    organizations = new FakeOrganizationRepository();
    memberships = new FakeMembershipRepository();
    service = new AccountService(organizations, memberships);
  });

  async function join(principalId: string, slug: string, role: 'owner' | 'admin' | 'operator' = 'owner', status: 'active' | 'invited' | 'revoked' = 'active') {
    const organization = await organizations.create({ name: `Org ${slug}`, slug });
    await memberships.create({ organizationId: organization.id, principalId, role, status });
    return organization;
  }

  it('returns who the caller is and the organizations they can enter, with their role', async () => {
    const acme = await join(alice.id, 'acme', 'admin');
    const overview = await service.overview(alice);
    expect(overview.principal).toEqual({ id: alice.id, email: alice.email, name: alice.name });
    expect(overview.organizations).toEqual([{ id: acme.id, name: 'Org acme', slug: 'acme', role: 'admin' }]);
  });

  it('is empty for a brand new account', async () => {
    expect((await service.overview(alice)).organizations).toEqual([]);
  });

  it('never lists organizations of other accounts', async () => {
    await join(bob.id, 'bobs-org');
    expect((await service.overview(alice)).organizations).toEqual([]);
  });

  it('hides revoked and invited memberships', async () => {
    await join(alice.id, 'revoked-org', 'owner', 'revoked');
    await join(alice.id, 'invited-org', 'owner', 'invited');
    const active = await join(alice.id, 'active-org');
    expect((await service.overview(alice)).organizations.map((o) => o.id)).toEqual([active.id]);
  });

  it('hides suspended organizations', async () => {
    const organization = await join(alice.id, 'suspended-org');
    organization.status = 'suspended';
    expect((await service.overview(alice)).organizations).toEqual([]);
  });

  it('lists every active organization sorted by name', async () => {
    await join(alice.id, 'zeta');
    await join(alice.id, 'alpha');
    expect((await service.overview(alice)).organizations.map((o) => o.slug)).toEqual(['alpha', 'zeta']);
  });
});
