import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildHttpTestApp,
  setupOwnerWithWorkspace,
} from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';

describe('runs HTTP routes', () => {
  let app: FastifyInstance;
  let principals: FakePrincipalRepository;

  beforeEach(async () => {
    ({ app, principals } = await buildHttpTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  type Tenant = Awaited<ReturnType<typeof setupOwnerWithWorkspace>>;
  const workspaceUrl = (t: Tenant) => `/v1/organizations/${t.org.id}/workspaces/${t.workspace.id}`;

  async function send(principalId: string | undefined, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) {
    const response = await app.inject({
      method,
      url,
      ...(principalId ? { headers: { 'x-principal-id': principalId } } : {}),
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Record<string, any> };
  }

  async function publishedAgent(t: Tenant, modelPolicy: object = { allowedProviders: ['mock'] }) {
    const created = await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents`, {
      name: 'Support',
      slug: `support-${crypto.randomUUID().slice(0, 8)}`,
    });
    const agentId = created.body.agent.id as string;
    await send(t.owner.id, 'PATCH', `${workspaceUrl(t)}/agents/${agentId}/draft`, {
      instructions: 'You are a helpful support agent.',
      modelPolicy,
    });
    const published = await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${agentId}/publish`);
    return { agentId, versionId: published.body.id as string };
  }

  it('requires authentication on every endpoint', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { agentId } = await publishedAgent(t);
    expect((await send(undefined, 'POST', `${workspaceUrl(t)}/agents/${agentId}/runs`, { input: 'hi' })).status).toBe(401);
    expect((await send(undefined, 'GET', `${workspaceUrl(t)}/runs`)).status).toBe(401);
    expect((await send(undefined, 'GET', `${workspaceUrl(t)}/runs/${crypto.randomUUID()}`)).status).toBe(401);
  });

  it('starts a run, returns it completed with the pinned version, and reads it back with its steps', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { agentId, versionId } = await publishedAgent(t);

    const started = await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${agentId}/runs`, { input: 'ping' });
    expect(started.status).toBe(201);
    expect(started.body.replayed).toBe(false);
    expect(started.body.run).toMatchObject({
      status: 'completed',
      agentId,
      agentVersionId: versionId,
      requestedByPrincipalId: t.owner.id,
      input: { text: 'ping' },
      output: { text: 'Mock response to: ping' },
      modelProvider: 'mock',
      errorCode: null,
    });

    const detail = await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs/${started.body.run.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.run.id).toBe(started.body.run.id);
    expect(detail.body.steps).toEqual([expect.objectContaining({ sequence: 1, type: 'model_call', status: 'completed' })]);
    expect(Object.keys(detail.body.steps[0])).not.toContain('runId');
  });

  it('replays an idempotent request with 200 and does not create a second run', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { agentId } = await publishedAgent(t);
    const url = `${workspaceUrl(t)}/agents/${agentId}/runs`;

    const first = await send(t.owner.id, 'POST', url, { input: 'ping', idempotencyKey: 'abc-1' });
    const second = await send(t.owner.id, 'POST', url, { input: 'ping', idempotencyKey: 'abc-1' });
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.body).toMatchObject({ replayed: true, run: { id: first.body.run.id } });
    expect((await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs`)).body.runs).toHaveLength(1);
  });

  it('records a failed run (not an HTTP error) when the model policy has no route', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { agentId } = await publishedAgent(t, { allowedProviders: ['not-configured'] });
    const started = await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${agentId}/runs`, { input: 'ping' });
    expect(started.status).toBe(201);
    expect(started.body.run).toMatchObject({
      status: 'failed',
      errorCode: 'MODEL_POLICY_NO_ROUTE',
      output: null,
      errorMessage: expect.any(String),
    });
    expect(started.body.run.errorMessage).not.toContain('not-configured');
  });

  it('refuses unpublished, disabled and archived agents with 409', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const draft = (await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents`, { name: 'Draft', slug: 'draft-only' })).body.agent.id;
    expect((await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${draft}/runs`, { input: 'hi' })).status).toBe(409);

    const { agentId } = await publishedAgent(t);
    await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${agentId}/disable`);
    expect((await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${agentId}/runs`, { input: 'hi' })).status).toBe(409);
  });

  it('isolates tenants: another organization cannot start, list or read runs', async () => {
    const a = await setupOwnerWithWorkspace(app, principals);
    const b = await setupOwnerWithWorkspace(app, principals);
    const { agentId } = await publishedAgent(a);
    const run = (await send(a.owner.id, 'POST', `${workspaceUrl(a)}/agents/${agentId}/runs`, { input: 'secret-a' })).body.run;

    // B uses A's workspace and ids.
    expect((await send(b.owner.id, 'POST', `${workspaceUrl(a)}/agents/${agentId}/runs`, { input: 'x' })).status).toBe(403);
    expect((await send(b.owner.id, 'GET', `${workspaceUrl(a)}/runs`)).status).toBe(403);
    expect((await send(b.owner.id, 'GET', `${workspaceUrl(a)}/runs/${run.id}`)).status).toBe(403);
    // B pairs its own workspace with A's agent and run ids.
    expect((await send(b.owner.id, 'POST', `${workspaceUrl(b)}/agents/${agentId}/runs`, { input: 'x' })).status).toBe(404);
    expect((await send(b.owner.id, 'GET', `${workspaceUrl(b)}/runs/${run.id}`)).status).toBe(404);
    expect((await send(b.owner.id, 'GET', `${workspaceUrl(b)}/runs`)).body.runs).toEqual([]);
  });

  it('lists newest first with a cursor and filters by agent', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const one = await publishedAgent(t);
    const two = await publishedAgent(t);
    for (const [agent, text] of [[one, 'r1'], [two, 'r2'], [one, 'r3']] as const) {
      await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${agent.agentId}/runs`, { input: text });
    }

    const first = await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs?limit=2`);
    expect(first.body.runs.map((r: any) => r.input.text)).toEqual(['r3', 'r2']);
    const second = await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.runs.map((r: any) => r.input.text)).toEqual(['r1']);
    expect(second.body.nextCursor).toBeNull();

    const filtered = await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs?agentId=${two.agentId}`);
    expect(filtered.body.runs.map((r: any) => r.input.text)).toEqual(['r2']);
  });

  it.each([
    [{ input: '' }],
    [{}],
    [{ input: 'x'.repeat(20_001) }],
    [{ input: 'ok', idempotencyKey: 'has space' }],
    [{ input: 'ok', idempotencyKey: 'k'.repeat(101) }],
    [{ input: 5 }],
  ])('rejects the invalid body %j with 400 before running anything', async (payload) => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { agentId } = await publishedAgent(t);
    const response = await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${agentId}/runs`, payload);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
    expect((await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs`)).body.runs).toEqual([]);
  });

  it('rejects malformed ids, limits and cursors', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    expect((await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs/not-a-uuid`)).status).toBe(400);
    expect((await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs?limit=0`)).status).toBe(400);
    expect((await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs?limit=1000`)).status).toBe(400);
    expect((await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs?cursor=garbage`)).status).toBe(400);
    expect((await send(t.owner.id, 'GET', `${workspaceUrl(t)}/runs?agentId=nope`)).status).toBe(400);
  });

  it('does not accept client-supplied tools, model or tenant fields', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { agentId } = await publishedAgent(t);
    const response = await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${agentId}/runs`, {
      input: 'ping',
      tools: [{ name: 'drop_database' }],
      model: 'gpt-secret',
      organizationId: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
    expect(response.body.run.model).toBe('mock-1');
    expect(response.body.run.organizationId).toBeUndefined();
  });

  it('writes the run lifecycle into the audit trail without the task text', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { agentId } = await publishedAgent(t);
    await send(t.owner.id, 'POST', `${workspaceUrl(t)}/agents/${agentId}/runs`, { input: 'private customer data 99887' });
    const trail = await send(t.owner.id, 'GET', `/v1/organizations/${t.org.id}/audit-events`);
    const actions = (trail.body.events as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['run.started', 'run.completed']));
    expect(JSON.stringify(trail.body)).not.toContain('99887');
  });
});
