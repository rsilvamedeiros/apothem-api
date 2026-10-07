import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildHttpTestApp,
  setupOwnerWithWorkspace,
} from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';

describe('audit HTTP routes', () => {
  let app: FastifyInstance;
  let principals: FakePrincipalRepository;

  beforeEach(async () => {
    ({ app, principals } = await buildHttpTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const url = (orgId: string, query = '') => `/v1/organizations/${orgId}/audit-events${query}`;

  async function createAgent(tenant: Awaited<ReturnType<typeof setupOwnerWithWorkspace>>, slug: string) {
    await app.inject({
      method: 'POST',
      url: `/v1/organizations/${tenant.org.id}/workspaces/${tenant.workspace.id}/agents`,
      headers: { 'x-principal-id': tenant.owner.id },
      payload: { name: slug, slug },
    });
  }

  it('requires authentication', async () => {
    const tenant = await setupOwnerWithWorkspace(app, principals);
    const response = await app.inject({ method: 'GET', url: url(tenant.org.id) });
    expect(response.statusCode).toBe(401);
  });

  it('lets an owner read the events produced by their own actions, newest first', async () => {
    const tenant = await setupOwnerWithWorkspace(app, principals);
    await createAgent(tenant, 'first');

    const response = await app.inject({
      method: 'GET',
      url: url(tenant.org.id),
      headers: { 'x-principal-id': tenant.owner.id },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events.map((e: { action: string }) => e.action)).toEqual([
      'agent.created',
      'workspace.created',
      'membership.created',
      'organization.created',
    ]);
    expect(body.events[0]).toMatchObject({
      organizationId: tenant.org.id,
      workspaceId: tenant.workspace.id,
      actorPrincipalId: tenant.owner.id,
      targetType: 'agent',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(body.nextCursor).toBeNull();
  });

  it('denies a principal that is not a member of the organization with 403', async () => {
    const tenant = await setupOwnerWithWorkspace(app, principals);
    const outsider = await principals.create({ type: 'user', email: 'outsider@example.com', name: 'Outsider' });
    const response = await app.inject({
      method: 'GET',
      url: url(tenant.org.id),
      headers: { 'x-principal-id': outsider.id },
    });
    expect(response.statusCode).toBe(403);
  });

  it('never returns another organization events, even when asking for its workspace', async () => {
    const tenantA = await setupOwnerWithWorkspace(app, principals);
    const tenantB = await setupOwnerWithWorkspace(app, principals);
    await createAgent(tenantB, 'secret-b');

    const own = await app.inject({
      method: 'GET',
      url: url(tenantA.org.id, `?workspaceId=${tenantB.workspace.id}`),
      headers: { 'x-principal-id': tenantA.owner.id },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().events).toEqual([]);

    const crossTenant = await app.inject({
      method: 'GET',
      url: url(tenantB.org.id),
      headers: { 'x-principal-id': tenantA.owner.id },
    });
    expect(crossTenant.statusCode).toBe(403);
    expect(crossTenant.body).not.toContain('secret-b');
  });

  it('paginates with an opaque cursor', async () => {
    const tenant = await setupOwnerWithWorkspace(app, principals);
    await createAgent(tenant, 'one');
    await createAgent(tenant, 'two');
    const headers = { 'x-principal-id': tenant.owner.id };

    const first = await app.inject({ method: 'GET', url: url(tenant.org.id, '?limit=2'), headers });
    expect(first.json().events).toHaveLength(2);
    const cursor = first.json().nextCursor as string;
    expect(cursor).toEqual(expect.any(String));

    const second = await app.inject({
      method: 'GET',
      url: url(tenant.org.id, `?limit=10&cursor=${encodeURIComponent(cursor)}`),
      headers,
    });
    const seen = [...first.json().events, ...second.json().events].map((e: { id: string }) => e.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(5);
  });

  it('filters by action', async () => {
    const tenant = await setupOwnerWithWorkspace(app, principals);
    await createAgent(tenant, 'one');
    const response = await app.inject({
      method: 'GET',
      url: url(tenant.org.id, '?action=agent.created'),
      headers: { 'x-principal-id': tenant.owner.id },
    });
    expect(response.json().events.map((e: { action: string }) => e.action)).toEqual(['agent.created']);
  });

  it.each([
    ['limit=0'],
    ['limit=1000'],
    ['limit=abc'],
    ['cursor=garbage'],
    ['workspaceId=not-a-uuid'],
    ['action=DROP%20TABLE'],
  ])('rejects invalid query %s with 400', async (query) => {
    const tenant = await setupOwnerWithWorkspace(app, principals);
    const response = await app.inject({
      method: 'GET',
      url: url(tenant.org.id, `?${query}`),
      headers: { 'x-principal-id': tenant.owner.id },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_INPUT');
  });

  it('rejects a non-uuid organization id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/organizations/not-a-uuid/audit-events',
      headers: { 'x-principal-id': crypto.randomUUID() },
    });
    expect(response.statusCode).toBe(400);
  });
});
