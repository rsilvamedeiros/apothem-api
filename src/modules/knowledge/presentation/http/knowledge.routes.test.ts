import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildHttpTestApp, setupOwnerWithWorkspace } from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';

const POLICY = '# Refunds\n\nRefunds are issued to the original card within five business days.';

describe('knowledge HTTP routes', () => {
  let app: FastifyInstance;
  let principals: FakePrincipalRepository;

  beforeEach(async () => {
    ({ app, principals } = await buildHttpTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  type Tenant = Awaited<ReturnType<typeof setupOwnerWithWorkspace>>;
  const ws = (t: Tenant) => `/v1/organizations/${t.org.id}/workspaces/${t.workspace.id}`;
  const kb = (t: Tenant) => `${ws(t)}/knowledge-bases`;

  async function send(principalId: string | undefined, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
    const response = await app.inject({
      method,
      url,
      ...(principalId ? { headers: { 'x-principal-id': principalId } } : {}),
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as Record<string, any> };
  }

  async function member(t: Tenant, label: string, role: string) {
    const account = await principals.create({ type: 'user', email: `${label}-${crypto.randomUUID().slice(0, 6)}@example.com`, name: label });
    expect((await send(t.owner.id, 'POST', `/v1/organizations/${t.org.id}/members`, { email: account.email, role })).status).toBe(201);
    return account;
  }

  async function baseWithPolicy(t: Tenant, name = 'Handbook') {
    const base = await send(t.owner.id, 'POST', kb(t), { name });
    expect(base.status).toBe(201);
    const document = await send(t.owner.id, 'POST', `${kb(t)}/${base.body.id}/documents`, { title: 'Refund policy', content: POLICY });
    expect(document.status).toBe(201);
    return { baseId: base.body.id as string, documentId: document.body.document.id as string };
  }

  it('requires authentication on every route', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const id = crypto.randomUUID();
    const calls: [('GET' | 'POST' | 'DELETE'), string, object?][] = [
      ['POST', kb(t), { name: 'x' }],
      ['GET', kb(t)],
      ['GET', `${kb(t)}/${id}`],
      ['POST', `${kb(t)}/${id}/archive`],
      ['POST', `${kb(t)}/${id}/documents`, { title: 'x', content: 'x' }],
      ['GET', `${kb(t)}/${id}/documents`],
      ['DELETE', `${kb(t)}/${id}/documents/${id}`],
      ['POST', `${kb(t)}/${id}/search`, { query: 'x' }],
    ];
    for (const [method, url, payload] of calls) {
      expect((await send(undefined, method, url, payload)).status, `${method} ${url}`).toBe(401);
    }
  });

  it('creates, lists, reads and archives a base', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const created = await send(t.owner.id, 'POST', kb(t), { name: '  Handbook ', description: 'Policies' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Handbook', description: 'Policies', status: 'active', archivedAt: null });
    expect(created.body).not.toHaveProperty('workspaceId');

    expect((await send(t.owner.id, 'GET', kb(t))).body.knowledgeBases.map((b: { id: string }) => b.id)).toEqual([created.body.id]);
    expect((await send(t.owner.id, 'GET', `${kb(t)}/${created.body.id}`)).body.id).toBe(created.body.id);

    const archived = await send(t.owner.id, 'POST', `${kb(t)}/${created.body.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('archived');
    expect(archived.body.archivedAt).toEqual(expect.any(String));
    expect((await send(t.owner.id, 'POST', `${kb(t)}/${created.body.id}/archive`)).status).toBe(409);
  });

  it('refuses a duplicate name and invalid bodies', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    expect((await send(t.owner.id, 'POST', kb(t), { name: 'Docs' })).status).toBe(201);
    expect((await send(t.owner.id, 'POST', kb(t), { name: 'Docs' })).status).toBe(409);
    expect((await send(t.owner.id, 'POST', kb(t), {})).status).toBe(400);
    expect((await send(t.owner.id, 'POST', kb(t), { name: '' })).status).toBe(400);
    expect((await send(t.owner.id, 'POST', kb(t), { name: 'x'.repeat(101) })).status).toBe(400);
    expect((await send(t.owner.id, 'POST', kb(t), { name: 'ok', workspaceId: crypto.randomUUID() })).status).toBe(201);
  });

  it('rejects malformed ids with 400', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    expect((await send(t.owner.id, 'GET', `${kb(t)}/not-a-uuid`)).status).toBe(400);
    expect((await send(t.owner.id, 'GET', `${kb(t)}/${crypto.randomUUID()}`)).status).toBe(404);
  });

  it('adds a document, replays identical content, lists without text and removes it', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { baseId, documentId } = await baseWithPolicy(t);

    const again = await send(t.owner.id, 'POST', `${kb(t)}/${baseId}/documents`, { title: 'Renamed', content: `${POLICY}\n` });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ replayed: true, document: { id: documentId, title: 'Refund policy' } });

    const listed = await send(t.owner.id, 'GET', `${kb(t)}/${baseId}/documents`);
    expect(listed.body.documents).toEqual([
      expect.objectContaining({ id: documentId, knowledgeBaseId: baseId, title: 'Refund policy', chunkCount: 1, contentLength: POLICY.length }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain('five business days');

    expect((await send(t.owner.id, 'DELETE', `${kb(t)}/${baseId}/documents/${documentId}`)).status).toBe(204);
    expect((await send(t.owner.id, 'DELETE', `${kb(t)}/${baseId}/documents/${documentId}`)).status).toBe(404);
    expect((await send(t.owner.id, 'GET', `${kb(t)}/${baseId}/documents`)).body.documents).toEqual([]);
  });

  it('validates document bodies and refuses to add to an archived base', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { baseId } = await baseWithPolicy(t);
    const url = `${kb(t)}/${baseId}/documents`;
    expect((await send(t.owner.id, 'POST', url, { title: 'x' })).status).toBe(400);
    expect((await send(t.owner.id, 'POST', url, { title: '', content: 'x' })).status).toBe(400);
    expect((await send(t.owner.id, 'POST', url, { title: 'x', content: ' \u0000 ' })).status).toBe(400);
    await send(t.owner.id, 'POST', `${kb(t)}/${baseId}/archive`);
    expect((await send(t.owner.id, 'POST', url, { title: 'x', content: 'more text' })).status).toBe(409);
  });

  it('searches a base and returns passages with their source identity', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { baseId, documentId } = await baseWithPolicy(t);
    const found = await send(t.owner.id, 'POST', `${kb(t)}/${baseId}/search`, { query: 'how long does a refund take' });
    expect(found.status).toBe(200);
    expect(found.body.results).toEqual([
      expect.objectContaining({
        evidenceId: expect.any(String),
        knowledgeBaseId: baseId,
        documentId,
        title: 'Refund policy',
        section: 'Refunds',
        ordinal: 0,
        text: POLICY,
        score: expect.any(Number),
      }),
    ]);
    expect((await send(t.owner.id, 'POST', `${kb(t)}/${baseId}/search`, { query: 'unrelated zebra' })).body.results).toEqual([]);
    expect((await send(t.owner.id, 'POST', `${kb(t)}/${baseId}/search`, { query: '?! --' })).status).toBe(400);
    expect((await send(t.owner.id, 'POST', `${kb(t)}/${baseId}/search`, {})).status).toBe(400);
    await send(t.owner.id, 'POST', `${kb(t)}/${baseId}/archive`);
    expect((await send(t.owner.id, 'POST', `${kb(t)}/${baseId}/search`, { query: 'refund' })).status).toBe(409);
  });

  it('lets builders manage, operators read and search, and keeps auditors out', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const builder = await member(t, 'builder', 'builder');
    const operator = await member(t, 'operator', 'operator');
    const auditor = await member(t, 'auditor', 'auditor');
    const { baseId, documentId } = await baseWithPolicy(t);

    expect((await send(builder.id, 'POST', kb(t), { name: 'By builder' })).status).toBe(201);
    expect((await send(builder.id, 'POST', `${kb(t)}/${baseId}/documents`, { title: 'Doc', content: 'builder text' })).status).toBe(201);

    expect((await send(operator.id, 'GET', kb(t))).status).toBe(200);
    expect((await send(operator.id, 'GET', `${kb(t)}/${baseId}/documents`)).status).toBe(200);
    expect((await send(operator.id, 'POST', `${kb(t)}/${baseId}/search`, { query: 'refund' })).status).toBe(200);
    expect((await send(operator.id, 'POST', kb(t), { name: 'Nope' })).status).toBe(403);
    expect((await send(operator.id, 'POST', `${kb(t)}/${baseId}/documents`, { title: 'x', content: 'x text' })).status).toBe(403);
    expect((await send(operator.id, 'DELETE', `${kb(t)}/${baseId}/documents/${documentId}`)).status).toBe(403);
    expect((await send(operator.id, 'POST', `${kb(t)}/${baseId}/archive`)).status).toBe(403);

    for (const [method, url, payload] of [
      ['GET', kb(t)],
      ['GET', `${kb(t)}/${baseId}`],
      ['GET', `${kb(t)}/${baseId}/documents`],
      ['POST', `${kb(t)}/${baseId}/search`, { query: 'refund' }],
    ] as const) {
      expect((await send(auditor.id, method, url, payload)).status, `${method} ${url}`).toBe(403);
    }
  });

  it('keeps one workspace and one organization out of the other', async () => {
    const a = await setupOwnerWithWorkspace(app, principals);
    const b = await setupOwnerWithWorkspace(app, principals);
    const { baseId, documentId } = await baseWithPolicy(a);

    // Another organization's owner is not even a member here.
    expect([403, 404]).toContain((await send(b.owner.id, 'GET', `${kb(a)}/${baseId}`)).status);
    expect([403, 404]).toContain((await send(b.owner.id, 'POST', `${kb(a)}/${baseId}/search`, { query: 'refund' })).status);

    // Their own workspace path with the other organization's ids finds nothing.
    expect((await send(b.owner.id, 'GET', `${kb(b)}/${baseId}`)).status).toBe(404);
    expect((await send(b.owner.id, 'POST', `${kb(b)}/${baseId}/search`, { query: 'refund' })).status).toBe(404);
    expect((await send(b.owner.id, 'DELETE', `${kb(b)}/${baseId}/documents/${documentId}`)).status).toBe(404);
    expect((await send(b.owner.id, 'GET', kb(b))).body.knowledgeBases).toEqual([]);
    expect((await send(a.owner.id, 'GET', `${kb(a)}/${baseId}/documents`)).body.documents).toHaveLength(1);
  });

  it('audits creation and ingestion with ids and sizes, never with the text', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { documentId } = await baseWithPolicy(t);
    const trail = await send(t.owner.id, 'GET', `/v1/organizations/${t.org.id}/audit-events?limit=100`);
    const actions = (trail.body.events as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['knowledge_base.created', 'knowledge_document.added']));
    expect(JSON.stringify(trail.body)).not.toContain('five business days');
    expect((trail.body.events as { action: string; targetId: string }[]).find((e) => e.action === 'knowledge_document.added')!.targetId).toBe(documentId);
  });

  it('lets an agent answer from the bound base through the model, with the evidence on record', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const { baseId } = await baseWithPolicy(t);

    const created = await send(t.owner.id, 'POST', `${ws(t)}/agents`, { name: 'Support', slug: 'support' });
    const agentId = created.body.agent.id as string;
    await send(t.owner.id, 'PATCH', `${ws(t)}/agents/${agentId}/draft`, {
      instructions: 'Answer from the handbook.',
      modelPolicy: { allowedProviders: ['mock'] },
      toolBindings: [{ tool: 'search_knowledge', approval: 'auto' }],
      knowledgeBindings: [{ knowledgeBaseId: baseId }],
    });
    expect((await send(t.owner.id, 'POST', `${ws(t)}/agents/${agentId}/publish`)).status).toBe(201);

    const started = await send(t.owner.id, 'POST', `${ws(t)}/agents/${agentId}/runs`, {
      input: '__mock_tool_call__ search_knowledge {"query":"how long do refunds take"}',
    });
    expect(started.status).toBe(201);
    expect(started.body.run.status).toBe('completed');
    expect(started.body.run.output.text).toContain('TOOL RESULT for search_knowledge');
    expect(started.body.run.output.text).toContain('Refund policy');
    expect(started.body.run.output.text).toContain('within five business days');

    const detail = await send(t.owner.id, 'GET', `${ws(t)}/runs/${started.body.run.id}`);
    // The public step view lists the retrieval but never the tool arguments or results (those stay in the durable record).
    const steps = detail.body.steps as { type: string; status: string }[];
    expect(steps.map((s) => [s.type, s.status])).toEqual([
      ['model_call', 'completed'],
      ['tool_call', 'completed'],
      ['model_call', 'completed'],
    ]);
    expect(JSON.stringify(steps)).not.toContain('five business days');
  });

  it('refuses to publish an agent whose knowledge bindings are malformed', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const created = await send(t.owner.id, 'POST', `${ws(t)}/agents`, { name: 'Support', slug: 'support' });
    const agentId = created.body.agent.id as string;
    await send(t.owner.id, 'PATCH', `${ws(t)}/agents/${agentId}/draft`, { instructions: 'x', knowledgeBindings: [{ knowledgeBaseId: 'all' }] });
    const published = await send(t.owner.id, 'POST', `${ws(t)}/agents/${agentId}/publish`);
    expect(published.status).toBe(400);
    expect(published.body.error.message).toMatch(/Invalid knowledge bindings/);
  });
});
