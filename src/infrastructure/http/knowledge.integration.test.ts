import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { loadEnv } from './env.js';
import { createTestDatabase, type TestDatabase } from '../database/__fixtures__/test-database.js';

const ISSUER = 'https://auth.apothemai.com.br';
const AUDIENCE = 'apothem-api';
const SECRET = 'a-very-long-random-secret-of-at-least-32-chars';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused/unused',
  REDIS_URL: 'redis://unused',
  STORAGE_ENDPOINT: 'http://unused',
  STORAGE_ACCESS_KEY_ID: 'unused',
  STORAGE_SECRET_ACCESS_KEY: 'unused',
  STORAGE_BUCKET: 'unused',
  AUTH_SECRET: SECRET,
  AUTH_MODE: 'jwt',
  AUTH_JWT_ISSUER: ISSUER,
  AUTH_JWT_AUDIENCE: AUDIENCE,
  AUTH_JIT_PROVISIONING: 'true',
});

const POLICY = '# Refunds\n\nRefunds are issued to the original card within five business days.';
const SHIPPING = '# Shipping\n\nStandard shipping takes three business days.';

describe('knowledge through the real services on Postgres (integration)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildServer(env, database.db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  const bearerFor = (email: string) =>
    new SignJWT({ email, email_verified: true, name: email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(email)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));

  async function call(bearer: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Record<string, any> };
  }

  async function tenant(label: string) {
    const bearer = await bearerFor(`${label}@example.com`);
    const org = await call(bearer, 'POST', '/v1/organizations', { name: label, slug: label });
    const workspace = await call(bearer, 'POST', `/v1/organizations/${org.body.id}/workspaces`, { name: 'Main', slug: 'main' });
    const root = `/v1/organizations/${org.body.id}/workspaces/${workspace.body.id}`;
    return { bearer, org: org.body, root, kb: `${root}/knowledge-bases` };
  }

  it('ingests, searches in ranking order, and stops after removal and archiving', async () => {
    const t = await tenant('kb-flow');
    const base = await call(t.bearer, 'POST', t.kb, { name: 'Handbook' });
    expect(base.status).toBe(201);
    const refunds = await call(t.bearer, 'POST', `${t.kb}/${base.body.id}/documents`, { title: 'Refund policy', content: POLICY });
    const shipping = await call(t.bearer, 'POST', `${t.kb}/${base.body.id}/documents`, { title: 'Shipping', content: SHIPPING });
    expect([refunds.status, shipping.status]).toEqual([201, 201]);

    const duplicate = await call(t.bearer, 'POST', `${t.kb}/${base.body.id}/documents`, { title: 'Again', content: POLICY });
    expect(duplicate).toMatchObject({ status: 200, body: { replayed: true, document: { id: refunds.body.document.id } } });

    const found = await call(t.bearer, 'POST', `${t.kb}/${base.body.id}/search`, { query: 'How long until my refund arrives?' });
    expect(found.status).toBe(200);
    expect(found.body.results[0]).toMatchObject({ title: 'Refund policy', section: 'Refunds', ordinal: 0, knowledgeBaseId: base.body.id });
    expect(found.body.results[0].text).toContain('five business days');

    expect((await call(t.bearer, 'DELETE', `${t.kb}/${base.body.id}/documents/${refunds.body.document.id}`)).status).toBe(204);
    const after = await call(t.bearer, 'POST', `${t.kb}/${base.body.id}/search`, { query: 'refund' });
    expect(after.body.results).toEqual([]);

    expect((await call(t.bearer, 'POST', `${t.kb}/${base.body.id}/archive`)).status).toBe(200);
    expect((await call(t.bearer, 'POST', `${t.kb}/${base.body.id}/search`, { query: 'shipping' })).status).toBe(409);
  });

  it('keeps tenants apart even when ids are guessed', async () => {
    const a = await tenant('kb-iso-a');
    const b = await tenant('kb-iso-b');
    const base = await call(a.bearer, 'POST', a.kb, { name: 'Secrets' });
    await call(a.bearer, 'POST', `${a.kb}/${base.body.id}/documents`, { title: 'Codename', content: 'the launch codename is falcon' });

    expect([403, 404]).toContain((await call(b.bearer, 'POST', `${a.kb}/${base.body.id}/search`, { query: 'falcon' })).status);
    expect((await call(b.bearer, 'POST', `${b.kb}/${base.body.id}/search`, { query: 'falcon' })).status).toBe(404);
    expect((await call(b.bearer, 'GET', b.kb)).body.knowledgeBases).toEqual([]);
  });

  it('lets an agent ground a run in the bound base, and nothing outside it', async () => {
    const t = await tenant('kb-agent');
    const bound = await call(t.bearer, 'POST', t.kb, { name: 'Bound' });
    const other = await call(t.bearer, 'POST', t.kb, { name: 'Other' });
    await call(t.bearer, 'POST', `${t.kb}/${bound.body.id}/documents`, { title: 'Refund policy', content: POLICY });
    await call(t.bearer, 'POST', `${t.kb}/${other.body.id}/documents`, { title: 'Refund secrets', content: 'refund secrets for finance only' });

    const agent = await call(t.bearer, 'POST', `${t.root}/agents`, { name: 'Support', slug: 'support' });
    await call(t.bearer, 'PATCH', `${t.root}/agents/${agent.body.agent.id}/draft`, {
      instructions: 'Answer from the handbook.',
      modelPolicy: { allowedProviders: ['mock'] },
      toolBindings: [{ tool: 'search_knowledge', approval: 'auto' }],
      knowledgeBindings: [{ knowledgeBaseId: bound.body.id }],
    });
    expect((await call(t.bearer, 'POST', `${t.root}/agents/${agent.body.agent.id}/publish`)).status).toBe(201);

    const run = await call(t.bearer, 'POST', `${t.root}/agents/${agent.body.agent.id}/runs`, {
      input: '__mock_tool_call__ search_knowledge {"query":"refund"}',
    });
    expect(run.body.run.status).toBe('completed');
    expect(run.body.run.output.text).toContain('Refund policy');
    expect(run.body.run.output.text).toContain('five business days');
    expect(run.body.run.output.text).not.toContain('finance only');
  });

  it('writes the audit trail without any text', async () => {
    const t = await tenant('kb-audit');
    const base = await call(t.bearer, 'POST', t.kb, { name: 'Docs' });
    await call(t.bearer, 'POST', `${t.kb}/${base.body.id}/documents`, { title: 'Doc', content: 'private words about pandas' });
    const trail = await call(t.bearer, 'GET', `/v1/organizations/${t.org.id}/audit-events?limit=100`);
    const actions = (trail.body.events as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['knowledge_base.created', 'knowledge_document.added']));
    expect(JSON.stringify(trail.body)).not.toContain('pandas');
  });
});
