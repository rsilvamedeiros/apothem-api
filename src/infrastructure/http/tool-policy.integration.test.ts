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

const WRITE = '__mock_tool_call__ create_note {"title":"Call back","body":"Tomorrow 10am"}';

describe('workspace tool policy through the real services on Postgres (integration)', () => {
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

  async function call(bearer: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Record<string, any> };
  }

  async function tenant(label: string) {
    const bearer = await bearerFor(`${label}@example.com`);
    const org = await call(bearer, 'POST', '/v1/organizations', { name: label, slug: label });
    const workspace = await call(bearer, 'POST', `/v1/organizations/${org.body.id}/workspaces`, { name: 'Main', slug: 'main' });
    const root = `/v1/organizations/${org.body.id}/workspaces/${workspace.body.id}`;
    const agent = await call(bearer, 'POST', `${root}/agents`, { name: 'Notes', slug: 'notes' });
    await call(bearer, 'PATCH', `${root}/agents/${agent.body.agent.id}/draft`, {
      instructions: 'Save notes when asked.',
      modelPolicy: { allowedProviders: ['mock'] },
      toolBindings: [{ tool: 'create_note', approval: 'auto' }],
    });
    expect((await call(bearer, 'POST', `${root}/agents/${agent.body.agent.id}/publish`)).status).toBe(201);
    return { bearer, root, org: org.body, agentId: agent.body.agent.id as string };
  }

  it('stores, replaces and removes a rule, and the next run obeys it', async () => {
    const t = await tenant('tp-flow');
    const policy = `${t.root}/tool-policies/create_note`;
    const run = () => call(t.bearer, 'POST', `${t.root}/agents/${t.agentId}/runs`, { input: WRITE });

    expect((await run()).body.run.status).toBe('completed');

    expect((await call(t.bearer, 'PUT', policy, { rule: 'approval_required' })).body).toMatchObject({ rule: 'approval_required', changed: true });
    expect((await run()).body.run.status).toBe('waiting_approval');

    expect((await call(t.bearer, 'PUT', policy, { rule: 'blocked' })).body).toMatchObject({ rule: 'blocked', changed: true });
    expect((await call(t.bearer, 'GET', `${t.root}/tool-policies`)).body.policies).toHaveLength(1);
    const blocked = await run();
    expect(blocked.body.run.status).toBe('completed');
    expect(blocked.body.run.output.text).not.toContain('TOOL RESULT');

    expect((await call(t.bearer, 'DELETE', policy)).status).toBe(204);
    expect((await run()).body.run.output.text).toContain('TOOL RESULT for create_note');
  });

  it('invalidates the approval that was waiting when its tool gets blocked', async () => {
    const t = await tenant('tp-waiting');
    await call(t.bearer, 'PUT', `${t.root}/tool-policies/create_note`, { rule: 'approval_required' });
    const started = await call(t.bearer, 'POST', `${t.root}/agents/${t.agentId}/runs`, { input: WRITE });
    const approvals = await call(t.bearer, 'GET', `${t.root}/approvals?status=pending`);
    const approvalId = approvals.body.approvals[0].id as string;

    await call(t.bearer, 'PUT', `${t.root}/tool-policies/create_note`, { rule: 'blocked' });
    const decided = await call(t.bearer, 'POST', `${t.root}/approvals/${approvalId}/decision`, { decision: 'approve' });
    expect(decided.status).toBe(409);

    const detail = await call(t.bearer, 'GET', `${t.root}/runs/${started.body.run.id}`);
    expect(detail.body.run).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_INVALIDATED' });
  });

  it('keeps rules inside their workspace and audits the changes', async () => {
    const a = await tenant('tp-iso-a');
    const b = await tenant('tp-iso-b');
    await call(a.bearer, 'PUT', `${a.root}/tool-policies/create_note`, { rule: 'blocked' });
    expect((await call(b.bearer, 'GET', `${b.root}/tool-policies`)).body.policies).toEqual([]);
    expect([403, 404]).toContain((await call(b.bearer, 'GET', `${a.root}/tool-policies`)).status);

    const trail = await call(a.bearer, 'GET', `/v1/organizations/${a.org.id}/audit-events?limit=100`);
    expect((trail.body.events as { action: string }[]).map((e) => e.action)).toContain('tool_policy.set');
  });
});
