import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildHttpTestApp,
  setupOwnerWithWorkspace,
} from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';

describe('members HTTP routes', () => {
  let app: FastifyInstance;
  let principals: FakePrincipalRepository;

  beforeEach(async () => {
    ({ app, principals } = await buildHttpTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const url = (orgId: string, suffix = '') => `/v1/organizations/${orgId}/members${suffix}`;

  async function send(principalId: string | undefined, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object) {
    const response = await app.inject({
      method,
      url: path,
      ...(principalId ? { headers: { 'x-principal-id': principalId } } : {}),
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Record<string, any> };
  }

  async function account(label: string) {
    return principals.create({ type: 'user', email: `${label}@example.com`, name: label });
  }

  it('requires authentication', async () => {
    const { org } = await setupOwnerWithWorkspace(app, principals);
    expect((await send(undefined, 'GET', url(org.id))).status).toBe(401);
  });

  it('lists the owner who created the organization', async () => {
    const { owner, org } = await setupOwnerWithWorkspace(app, principals);
    const response = await send(owner.id, 'GET', url(org.id));
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ principalId: owner.id, role: 'owner', status: 'active', email: owner.email }),
    ]);
  });

  it('runs add, change role and revoke, leaving an audit trail', async () => {
    const { owner, org } = await setupOwnerWithWorkspace(app, principals);
    const friend = await account('friend');

    const added = await send(owner.id, 'POST', url(org.id), { email: friend.email, role: 'builder' });
    expect(added.status).toBe(201);
    const membershipId = added.body.membershipId as string;

    const changed = await send(owner.id, 'PATCH', url(org.id, `/${membershipId}`), { role: 'auditor' });
    expect(changed.status).toBe(200);
    expect(changed.body.role).toBe('auditor');

    const revoked = await send(owner.id, 'POST', url(org.id, `/${membershipId}/revoke`));
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe('revoked');

    // A revoked member loses access immediately.
    expect((await send(friend.id, 'GET', url(org.id))).status).toBe(403);

    const trail = await send(owner.id, 'GET', `/v1/organizations/${org.id}/audit-events`);
    const actions = (trail.body.events as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['membership.created', 'membership.role_changed', 'membership.revoked']),
    );
  });

  it('gives a new member exactly the access of the role they were given', async () => {
    const { owner, org } = await setupOwnerWithWorkspace(app, principals);
    const operator = await account('operator');
    await send(owner.id, 'POST', url(org.id), { email: operator.email, role: 'operator' });

    expect((await send(operator.id, 'GET', url(org.id))).status).toBe(200);
    expect((await send(operator.id, 'POST', url(org.id), { email: owner.email, role: 'operator' })).status).toBe(403);
    expect((await send(operator.id, 'GET', `/v1/organizations/${org.id}/audit-events`)).status).toBe(403);
  });

  it('stops an admin from escalating anyone to owner', async () => {
    const { owner, org } = await setupOwnerWithWorkspace(app, principals);
    const admin = await account('admin');
    const friend = await account('friend');
    const adminMembership = (await send(owner.id, 'POST', url(org.id), { email: admin.email, role: 'admin' })).body;

    const escalate = await send(admin.id, 'POST', url(org.id), { email: friend.email, role: 'owner' });
    expect(escalate.status).toBe(403);
    const selfPromote = await send(admin.id, 'PATCH', url(org.id, `/${adminMembership.membershipId}`), { role: 'owner' });
    expect(selfPromote.status).toBe(403);
  });

  it('protects the last owner', async () => {
    const { owner, org } = await setupOwnerWithWorkspace(app, principals);
    const [self] = (await send(owner.id, 'GET', url(org.id))).body as { membershipId: string }[];
    expect((await send(owner.id, 'PATCH', url(org.id, `/${self!.membershipId}`), { role: 'admin' })).status).toBe(409);
    expect((await send(owner.id, 'POST', url(org.id, `/${self!.membershipId}/revoke`))).status).toBe(409);
  });

  it('isolates organizations: members of another organization are neither visible nor changeable', async () => {
    const a = await setupOwnerWithWorkspace(app, principals);
    const b = await setupOwnerWithWorkspace(app, principals);
    const [bMember] = (await send(b.owner.id, 'GET', url(b.org.id))).body as { membershipId: string }[];

    expect((await send(a.owner.id, 'GET', url(b.org.id))).status).toBe(403);
    // A pairs its own organization with B's membership id.
    const probe = await send(a.owner.id, 'PATCH', url(a.org.id, `/${bMember!.membershipId}`), { role: 'auditor' });
    expect(probe.status).toBe(404);
    expect((await send(a.owner.id, 'POST', url(a.org.id, `/${bMember!.membershipId}/revoke`))).status).toBe(404);
    // B is untouched.
    expect((await send(b.owner.id, 'GET', url(b.org.id))).body[0].role).toBe('owner');
  });

  it('answers 404 for an unknown email and 409 for a duplicate member', async () => {
    const { owner, org } = await setupOwnerWithWorkspace(app, principals);
    expect((await send(owner.id, 'POST', url(org.id), { email: 'nobody@example.com', role: 'operator' })).status).toBe(404);
    expect((await send(owner.id, 'POST', url(org.id), { email: owner.email, role: 'operator' })).status).toBe(409);
  });

  it.each([
    [{ email: 'not-an-email', role: 'operator' }],
    [{ email: 'a@example.com', role: 'superadmin' }],
    [{ email: 'a@example.com' }],
    [{ role: 'operator' }],
    [{ email: 'a@example.com', role: 'toString' }],
  ])('rejects an invalid body %j with 400', async (body) => {
    const { owner, org } = await setupOwnerWithWorkspace(app, principals);
    const response = await send(owner.id, 'POST', url(org.id), body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects non-uuid path parameters', async () => {
    const { owner, org } = await setupOwnerWithWorkspace(app, principals);
    expect((await send(owner.id, 'PATCH', url(org.id, '/not-a-uuid'), { role: 'operator' })).status).toBe(400);
    expect((await send(owner.id, 'GET', '/v1/organizations/not-a-uuid/members')).status).toBe(400);
  });
});
