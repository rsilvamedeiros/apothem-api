import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { testEnv } from './__fixtures__/http-test-harness.js';
import { createTestDatabase, type TestDatabase } from '../database/__fixtures__/test-database.js';
import { PrincipalRepository } from '../../modules/identity/infrastructure/principal.repository.js';

/**
 * Whole stack: HTTP routes, middleware, application services, authorization
 * and the real Drizzle repositories on Postgres with the committed
 * migrations. Nothing is faked below the network edge.
 */
describe('API on real Postgres (integration)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let principals: PrincipalRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildServer(testEnv, database.db);
    await app.ready();
    principals = new PrincipalRepository(database.db);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  async function owner(label: string) {
    return principals.create({ type: 'user', email: `${label}@example.com`, name: label });
  }

  async function call(principalId: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) {
    const response = await app.inject({
      method,
      url,
      headers: { 'x-principal-id': principalId },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Record<string, any> };
  }

  async function bootstrap(label: string) {
    const principal = await owner(label);
    const org = (await call(principal.id, 'POST', '/v1/organizations', { name: label, slug: label })).body;
    const workspace = (
      await call(principal.id, 'POST', `/v1/organizations/${org.id}/workspaces`, { name: 'Main', slug: 'main' })
    ).body;
    return { principal, org, workspace, base: `/v1/organizations/${org.id}/workspaces/${workspace.id}/agents` };
  }

  it('runs the whole agent journey and leaves a complete audit trail', async () => {
    const t = await bootstrap('journey');

    const created = await call(t.principal.id, 'POST', t.base, { name: 'Support', slug: 'support' });
    expect(created.status).toBe(201);
    const agentId = created.body.agent.id as string;

    expect((await call(t.principal.id, 'POST', `${t.base}/${agentId}/publish`)).status).toBe(400);

    const patched = await call(t.principal.id, 'PATCH', `${t.base}/${agentId}/draft`, {
      instructions: 'Answer politely.',
      guardrails: { maxSteps: 3 },
    });
    expect(patched.status).toBe(200);

    const published = await call(t.principal.id, 'POST', `${t.base}/${agentId}/publish`);
    expect(published.status).toBe(201);
    expect(published.body).toMatchObject({ versionNumber: 1, checksum: expect.stringMatching(/^[0-9a-f]{64}$/) });

    const detail = await call(t.principal.id, 'GET', `${t.base}/${agentId}`);
    expect(detail.body.agent).toMatchObject({ status: 'active', activeVersionId: published.body.id });

    const versions = await call(t.principal.id, 'GET', `${t.base}/${agentId}/versions`);
    expect(versions.body).toHaveLength(1);

    expect((await call(t.principal.id, 'POST', `${t.base}/${agentId}/archive`)).status).toBe(200);
    expect((await call(t.principal.id, 'POST', `${t.base}/${agentId}/disable`)).status).toBe(409);

    const trail = await call(t.principal.id, 'GET', `/v1/organizations/${t.org.id}/audit-events?limit=50`);
    expect(trail.status).toBe(200);
    expect((trail.body.events as { action: string }[]).map((e) => e.action).reverse()).toEqual([
      'organization.created',
      'membership.created',
      'workspace.created',
      'agent.created',
      'agent.draft_updated',
      'agent.version_published',
      'agent.archived',
    ]);
  });

  it('isolates tenants end to end: another organization sees nothing and is denied by id', async () => {
    const a = await bootstrap('tenant-a');
    const b = await bootstrap('tenant-b');
    const secret = await call(b.principal.id, 'POST', b.base, { name: 'B secret', slug: 'b-secret' });
    const secretId = secret.body.agent.id as string;

    // A pairs its own org/workspace with B's agent id.
    expect((await call(a.principal.id, 'GET', `${a.base}/${secretId}`)).status).toBe(404);
    expect((await call(a.principal.id, 'GET', a.base)).body).toEqual([]);
    // A uses B's organization and workspace ids.
    expect((await call(a.principal.id, 'GET', b.base)).status).toBe(403);
    expect((await call(a.principal.id, 'GET', `/v1/organizations/${b.org.id}`)).status).toBe(403);
    // A cannot read B's audit log, and its own contains nothing of B's.
    expect((await call(a.principal.id, 'GET', `/v1/organizations/${b.org.id}/audit-events`)).status).toBe(403);
    const ownTrail = await call(a.principal.id, 'GET', `/v1/organizations/${a.org.id}/audit-events`);
    expect(JSON.stringify(ownTrail.body)).not.toContain('b-secret');
    expect(JSON.stringify(ownTrail.body)).not.toContain(b.org.id);
  });

  it('returns 409 for a duplicate organization slug instead of a database error', async () => {
    const first = await owner('dup-first');
    const second = await owner('dup-second');
    await call(first.id, 'POST', '/v1/organizations', { name: 'Dup', slug: 'dup-slug' });
    const duplicate = await call(second.id, 'POST', '/v1/organizations', { name: 'Dup', slug: 'dup-slug' });
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).not.toMatch(/duplicate key|constraint|unique/i);
  });

  it('rejects unknown principals and requests without credentials', async () => {
    const t = await bootstrap('auth');
    expect((await call(crypto.randomUUID(), 'GET', `/v1/organizations/${t.org.id}`)).status).toBe(401);
    const missing = await app.inject({ method: 'GET', url: `/v1/organizations/${t.org.id}` });
    expect(missing.statusCode).toBe(401);
  });

  it('pages the audit log through the real keyset query', async () => {
    const t = await bootstrap('paging');
    for (const slug of ['a', 'b', 'c']) {
      await call(t.principal.id, 'POST', t.base, { name: slug, slug });
    }
    const first = await call(t.principal.id, 'GET', `/v1/organizations/${t.org.id}/audit-events?limit=3`);
    expect(first.body.events).toHaveLength(3);
    const second = await call(
      t.principal.id,
      'GET',
      `/v1/organizations/${t.org.id}/audit-events?limit=10&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    );
    const ids = [...first.body.events, ...second.body.events].map((e: { id: string }) => e.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(second.body.nextCursor).toBeNull();
  });

  it('manages members on the real schema: add, promote within limits, revoke, reactivate', async () => {
    const t = await bootstrap('members');
    const friend = await owner('members-friend');
    const members = `/v1/organizations/${t.org.id}/members`;

    const added = await call(t.principal.id, 'POST', members, { email: friend.email, role: 'builder' });
    expect(added.status).toBe(201);
    const membershipId = added.body.membershipId as string;

    expect((await call(friend.id, 'GET', members)).status).toBe(200);
    const promoted = await call(t.principal.id, 'PATCH', `${members}/${membershipId}`, { role: 'admin' });
    expect(promoted.body.role).toBe('admin');

    const revoked = await call(t.principal.id, 'POST', `${members}/${membershipId}/revoke`);
    expect(revoked.body.status).toBe('revoked');
    expect((await call(friend.id, 'GET', members)).status).toBe(403);

    const again = await call(t.principal.id, 'POST', members, { email: friend.email, role: 'auditor' });
    expect(again.status).toBe(201);
    expect(again.body.membershipId).toBe(membershipId);
    expect(again.body).toMatchObject({ role: 'auditor', status: 'active' });

    const list = await call(t.principal.id, 'GET', members);
    expect(list.body).toHaveLength(2);

    const [self] = (list.body as { membershipId: string; principalId: string }[]).filter((m) => m.principalId === t.principal.id);
    expect((await call(t.principal.id, 'PATCH', members + '/' + self!.membershipId, { role: 'admin' })).status).toBe(409);
  });
});
