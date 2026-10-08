import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildHttpTestApp, setupOwnerWithWorkspace } from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';

const WRITE = '__mock_tool_call__ create_note {"title":"Call back","body":"Tomorrow 10am"}';

describe('tool policy HTTP routes', () => {
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
  const policies = (t: Tenant) => `${ws(t)}/tool-policies`;

  async function send(principalId: string | undefined, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) {
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

  async function publishedNoteAgent(t: Tenant, approval: 'auto' | 'required') {
    const created = await send(t.owner.id, 'POST', `${ws(t)}/agents`, { name: 'Notes', slug: `notes-${crypto.randomUUID().slice(0, 6)}` });
    const agentId = created.body.agent.id as string;
    await send(t.owner.id, 'PATCH', `${ws(t)}/agents/${agentId}/draft`, {
      instructions: 'Save notes when asked.',
      modelPolicy: { allowedProviders: ['mock'] },
      toolBindings: [{ tool: 'create_note', approval }],
    });
    expect((await send(t.owner.id, 'POST', `${ws(t)}/agents/${agentId}/publish`)).status).toBe(201);
    return agentId;
  }

  it('requires authentication on every route', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    expect((await send(undefined, 'GET', policies(t))).status).toBe(401);
    expect((await send(undefined, 'PUT', `${policies(t)}/create_note`, { rule: 'blocked' })).status).toBe(401);
    expect((await send(undefined, 'DELETE', `${policies(t)}/create_note`)).status).toBe(401);
  });

  it('starts with no rules, sets one, changes it and removes it', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    expect((await send(t.owner.id, 'GET', policies(t))).body).toEqual({ policies: [] });

    const set = await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, { rule: 'approval_required' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ toolName: 'create_note', rule: 'approval_required', changed: true });
    expect(set.body).not.toHaveProperty('workspaceId');

    const again = await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, { rule: 'approval_required' });
    expect(again.body.changed).toBe(false);

    await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, { rule: 'blocked' });
    expect((await send(t.owner.id, 'GET', policies(t))).body.policies).toEqual([
      expect.objectContaining({ toolName: 'create_note', rule: 'blocked', updatedByPrincipalId: t.owner.id }),
    ]);

    expect((await send(t.owner.id, 'DELETE', `${policies(t)}/create_note`)).status).toBe(204);
    expect((await send(t.owner.id, 'DELETE', `${policies(t)}/create_note`)).status).toBe(204);
    expect((await send(t.owner.id, 'GET', policies(t))).body.policies).toEqual([]);
  });

  it('rejects unknown tools, malformed names and unknown rules', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    expect((await send(t.owner.id, 'PUT', `${policies(t)}/drop_database`, { rule: 'blocked' })).status).toBe(404);
    expect((await send(t.owner.id, 'PUT', `${policies(t)}/Not-A-Tool!`, { rule: 'blocked' })).status).toBe(400);
    expect((await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, { rule: 'allow_everything' })).status).toBe(400);
    expect((await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, {})).status).toBe(400);
    expect((await send(t.owner.id, 'GET', policies(t))).body.policies).toEqual([]);
  });

  it('ignores a workspace id in the body: the workspace comes from the path and the membership', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const other = await setupOwnerWithWorkspace(app, principals);
    const response = await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, { rule: 'blocked', workspaceId: other.workspace.id });
    expect(response.status).toBe(200);
    expect((await send(other.owner.id, 'GET', policies(other))).body.policies).toEqual([]);
  });

  it('lets owners and admins change rules, everyone with access read them, and nobody else write', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const admin = await member(t, 'admin', 'admin');
    const builder = await member(t, 'builder', 'builder');
    const operator = await member(t, 'operator', 'operator');
    const auditor = await member(t, 'auditor', 'auditor');

    expect((await send(admin.id, 'PUT', `${policies(t)}/create_note`, { rule: 'blocked' })).status).toBe(200);
    for (const who of [builder, operator, auditor]) {
      expect((await send(who.id, 'GET', policies(t))).status).toBe(200);
      expect((await send(who.id, 'PUT', `${policies(t)}/create_note`, { rule: 'approval_required' })).status).toBe(403);
      expect((await send(who.id, 'DELETE', `${policies(t)}/create_note`)).status).toBe(403);
    }
    expect((await send(t.owner.id, 'GET', policies(t))).body.policies[0].rule).toBe('blocked');
  });

  it('keeps one organization out of another', async () => {
    const a = await setupOwnerWithWorkspace(app, principals);
    const b = await setupOwnerWithWorkspace(app, principals);
    await send(a.owner.id, 'PUT', `${policies(a)}/create_note`, { rule: 'blocked' });
    expect([403, 404]).toContain((await send(b.owner.id, 'GET', policies(a))).status);
    expect([403, 404]).toContain((await send(b.owner.id, 'PUT', `${policies(a)}/create_note`, { rule: 'approval_required' })).status);
    expect([403, 404]).toContain((await send(b.owner.id, 'DELETE', `${policies(a)}/create_note`)).status);
    expect((await send(a.owner.id, 'GET', policies(a))).body.policies).toHaveLength(1);
  });

  it('audits every change with the tool and the rules, never with free text', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, { rule: 'approval_required' });
    await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, { rule: 'blocked' });
    await send(t.owner.id, 'DELETE', `${policies(t)}/create_note`);
    const trail = await send(t.owner.id, 'GET', `/v1/organizations/${t.org.id}/audit-events?limit=100`);
    const events = (trail.body.events as { action: string; metadata: Record<string, unknown> }[]).filter((e) => e.action.startsWith('tool_policy.'));
    expect(events.map((e) => [e.action, e.metadata])).toEqual(
      expect.arrayContaining([
        ['tool_policy.set', { tool: 'create_note', rule: 'approval_required', previousRule: null }],
        ['tool_policy.set', { tool: 'create_note', rule: 'blocked', previousRule: 'approval_required' }],
        ['tool_policy.removed', { tool: 'create_note', previousRule: 'blocked' }],
      ]),
    );
  });

  describe('effect on runs (full flow with the mock model)', () => {
    it('blocks a tool for every agent of the workspace at the next run', async () => {
      const t = await setupOwnerWithWorkspace(app, principals);
      const agentId = await publishedNoteAgent(t, 'auto');
      await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, { rule: 'blocked' });

      // The blocked tool is not even described to the model, so it has nothing to propose and nothing runs.
      const started = await send(t.owner.id, 'POST', `${ws(t)}/agents/${agentId}/runs`, { input: WRITE });
      expect(started.status).toBe(201);
      expect(started.body.run.status).toBe('completed');
      expect(started.body.run.output.text).not.toContain('TOOL RESULT');
      expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals`)).body.approvals).toEqual([]);

      await send(t.owner.id, 'DELETE', `${policies(t)}/create_note`);
      const again = await send(t.owner.id, 'POST', `${ws(t)}/agents/${agentId}/runs`, { input: WRITE });
      expect(again.body.run.status).toBe('completed');
      expect(again.body.run.output.text).toContain('TOOL RESULT for create_note');
    });

    it('forces approval even though the agent binding says auto', async () => {
      const t = await setupOwnerWithWorkspace(app, principals);
      const agentId = await publishedNoteAgent(t, 'auto');
      await send(t.owner.id, 'PUT', `${policies(t)}/create_note`, { rule: 'approval_required' });

      const started = await send(t.owner.id, 'POST', `${ws(t)}/agents/${agentId}/runs`, { input: WRITE });
      expect(started.body.run.status).toBe('waiting_approval');
      expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals?status=pending`)).body.approvals).toHaveLength(1);
    });

    it('does not apply a rule of another workspace', async () => {
      const t = await setupOwnerWithWorkspace(app, principals);
      const other = await setupOwnerWithWorkspace(app, principals);
      const agentId = await publishedNoteAgent(t, 'auto');
      await send(other.owner.id, 'PUT', `${policies(other)}/create_note`, { rule: 'blocked' });
      const started = await send(t.owner.id, 'POST', `${ws(t)}/agents/${agentId}/runs`, { input: WRITE });
      expect(started.body.run.status).toBe('completed');
    });
  });
});
