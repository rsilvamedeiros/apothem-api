import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildHttpTestApp,
  setupOwnerWithWorkspace,
} from '../../../../infrastructure/http/__fixtures__/http-test-harness.js';
import type { FakePrincipalRepository } from '../../../../infrastructure/http/__fixtures__/fake-repositories.js';

const WRITE = '__mock_tool_call__ create_note {"title":"Call back","body":"Tomorrow 10am"}';

describe('approvals HTTP routes (full flow with the mock model)', () => {
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

  async function send(principalId: string | undefined, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) {
    const response = await app.inject({
      method,
      url,
      ...(principalId ? { headers: { 'x-principal-id': principalId } } : {}),
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json() as Record<string, any> };
  }

  async function member(t: Tenant, label: string, role: string) {
    const account = await principals.create({ type: 'user', email: `${label}-${crypto.randomUUID().slice(0, 6)}@example.com`, name: label });
    const added = await send(t.owner.id, 'POST', `/v1/organizations/${t.org.id}/members`, { email: account.email, role });
    expect(added.status).toBe(201);
    return account;
  }

  async function agentWithWriteTool(t: Tenant, approval: 'required' | 'auto' = 'required') {
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

  async function startWaitingRun(t: Tenant, starterId: string, agentId: string) {
    const started = await send(starterId, 'POST', `${ws(t)}/agents/${agentId}/runs`, { input: WRITE });
    expect(started.status).toBe(201);
    expect(started.body.run.status).toBe('waiting_approval');
    const detail = await send(starterId, 'GET', `${ws(t)}/runs/${started.body.run.id}`);
    return { runId: started.body.run.id as string, approval: detail.body.approvals[0] as Record<string, any> };
  }

  it('requires authentication', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    expect((await send(undefined, 'GET', `${ws(t)}/approvals`)).status).toBe(401);
    expect((await send(undefined, 'POST', `${ws(t)}/approvals/${crypto.randomUUID()}/decision`, { decision: 'approve' })).status).toBe(401);
  });

  it('summarises what needs a person: pending count, for deciders only, within the workspace', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const other = await setupOwnerWithWorkspace(app, principals);
    const builder = await member(t, 'builder', 'builder');
    const operator = await member(t, 'operator', 'operator');
    const auditor = await member(t, 'auditor', 'auditor');
    const agentId = await agentWithWriteTool(t);

    expect((await send(undefined, 'GET', `${ws(t)}/approvals/summary`)).status).toBe(401);
    expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals/summary`)).body).toEqual({ pending: 0 });

    const { approval } = await startWaitingRun(t, builder.id, agentId);
    expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals/summary`)).body).toEqual({ pending: 1 });
    expect((await send(other.owner.id, 'GET', `${ws(other)}/approvals/summary`)).body).toEqual({ pending: 0 });
    expect([403, 404]).toContain((await send(other.owner.id, 'GET', `${ws(t)}/approvals/summary`)).status);

    for (const who of [builder, operator, auditor]) {
      expect((await send(who.id, 'GET', `${ws(t)}/approvals/summary`)).status).toBe(403);
    }

    await send(t.owner.id, 'POST', `${ws(t)}/approvals/${approval.id}/decision`, { decision: 'reject' });
    expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals/summary`)).body.pending).toBe(0);
  });

  it('parks a write for approval, then an approver approves it and the run completes', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const builder = await member(t, 'builder', 'builder');
    const agentId = await agentWithWriteTool(t);

    const { runId, approval } = await startWaitingRun(t, builder.id, agentId);
    expect(approval).toMatchObject({
      status: 'pending',
      toolName: 'create_note',
      arguments: { title: 'Call back', body: 'Tomorrow 10am' },
      requestedByPrincipalId: builder.id,
      selfApproved: false,
      decidedAt: null,
    });

    const inbox = await send(t.owner.id, 'GET', `${ws(t)}/approvals?status=pending`);
    expect(inbox.body.approvals.map((a: { id: string }) => a.id)).toEqual([approval.id]);

    const decided = await send(t.owner.id, 'POST', `${ws(t)}/approvals/${approval.id}/decision`, { decision: 'approve', reason: 'ok' });
    expect(decided.status).toBe(200);
    expect(decided.body.approval).toMatchObject({ status: 'approved', decidedByPrincipalId: t.owner.id, decisionReason: 'ok' });
    expect(decided.body.run).toMatchObject({ id: runId, status: 'completed' });
    expect(decided.body.run.output.text).toContain('TOOL RESULT for create_note');

    const trail = await send(t.owner.id, 'GET', `/v1/organizations/${t.org.id}/audit-events?limit=100`);
    const actions = (trail.body.events as { action: string }[]).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['approval.requested', 'approval.approved', 'run.completed']));
    expect(JSON.stringify(trail.body)).not.toContain('Tomorrow 10am');
  });

  it('keeps a rejected action from ever happening', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const builder = await member(t, 'builder', 'builder');
    const agentId = await agentWithWriteTool(t);
    const { runId, approval } = await startWaitingRun(t, builder.id, agentId);

    const decided = await send(t.owner.id, 'POST', `${ws(t)}/approvals/${approval.id}/decision`, { decision: 'reject', reason: 'No' });
    expect(decided.status).toBe(200);
    expect(decided.body.run).toMatchObject({ id: runId, status: 'failed', errorCode: 'APPROVAL_REJECTED' });
    expect((await send(t.owner.id, 'POST', `${ws(t)}/approvals/${approval.id}/decision`, { decision: 'approve' })).status).toBe(409);
  });

  it('runs a write that the binding explicitly marks auto without any approval', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const agentId = await agentWithWriteTool(t, 'auto');
    const started = await send(t.owner.id, 'POST', `${ws(t)}/agents/${agentId}/runs`, { input: WRITE });
    expect(started.body.run.status).toBe('completed');
    expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals`)).body.approvals).toEqual([]);
  });

  it('shows the pending proposal on the run detail to whoever can read the run, but only deciders can act', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const builder = await member(t, 'builder', 'builder');
    const operator = await member(t, 'operator', 'operator');
    const agentId = await agentWithWriteTool(t);
    const { runId, approval } = await startWaitingRun(t, operator.id, agentId);

    expect((await send(operator.id, 'GET', `${ws(t)}/runs/${runId}`)).body.approvals).toHaveLength(1);
    for (const who of [builder, operator]) {
      expect((await send(who.id, 'GET', `${ws(t)}/approvals`)).status).toBe(403);
      expect((await send(who.id, 'POST', `${ws(t)}/approvals/${approval.id}/decision`, { decision: 'approve' })).status).toBe(403);
    }
    expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals?status=pending`)).body.approvals).toHaveLength(1);
  });

  it('enforces separation of duties, allowing a sole approver to decide their own request', async () => {
    const solo = await setupOwnerWithWorkspace(app, principals);
    const soloAgent = await agentWithWriteTool(solo);
    const own = await startWaitingRun(solo, solo.owner.id, soloAgent);
    const selfDecided = await send(solo.owner.id, 'POST', `${ws(solo)}/approvals/${own.approval.id}/decision`, { decision: 'approve' });
    expect(selfDecided.status).toBe(200);
    expect(selfDecided.body.approval.selfApproved).toBe(true);

    const team = await setupOwnerWithWorkspace(app, principals);
    await member(team, 'second-admin', 'admin');
    const teamAgent = await agentWithWriteTool(team);
    const mine = await startWaitingRun(team, team.owner.id, teamAgent);
    expect((await send(team.owner.id, 'POST', `${ws(team)}/approvals/${mine.approval.id}/decision`, { decision: 'approve' })).status).toBe(403);
  });

  it('isolates tenants: another organization cannot see or decide anything', async () => {
    const a = await setupOwnerWithWorkspace(app, principals);
    const b = await setupOwnerWithWorkspace(app, principals);
    const agentId = await agentWithWriteTool(a);
    const { approval } = await startWaitingRun(a, a.owner.id, agentId);

    expect((await send(b.owner.id, 'GET', `${ws(a)}/approvals`)).status).toBe(403);
    expect((await send(b.owner.id, 'POST', `${ws(a)}/approvals/${approval.id}/decision`, { decision: 'approve' })).status).toBe(403);
    expect((await send(b.owner.id, 'POST', `${ws(b)}/approvals/${approval.id}/decision`, { decision: 'approve' })).status).toBe(404);
    expect((await send(b.owner.id, 'GET', `${ws(b)}/approvals`)).body.approvals).toEqual([]);
    expect((await send(a.owner.id, 'GET', `${ws(a)}/approvals?status=pending`)).body.approvals).toHaveLength(1);
  });

  it.each([
    [{ decision: 'maybe' }],
    [{}],
    [{ decision: 'approve', reason: 'x'.repeat(501) }],
    [{ decision: 'approve', reason: 5 }],
    [{ decision: 1 }],
  ])('rejects the invalid decision body %j with 400', async (payload) => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const response = await send(t.owner.id, 'POST', `${ws(t)}/approvals/${crypto.randomUUID()}/decision`, payload);
    expect(response.status).toBe(400);
  });

  it('rejects malformed ids, status filters, limits and cursors', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    expect((await send(t.owner.id, 'POST', `${ws(t)}/approvals/not-a-uuid/decision`, { decision: 'approve' })).status).toBe(400);
    expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals?status=weird`)).status).toBe(400);
    expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals?limit=0`)).status).toBe(400);
    expect((await send(t.owner.id, 'GET', `${ws(t)}/approvals?cursor=garbage`)).status).toBe(400);
  });

  it('answers 404 for an approval that does not exist', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    expect((await send(t.owner.id, 'POST', `${ws(t)}/approvals/${crypto.randomUUID()}/decision`, { decision: 'approve' })).status).toBe(404);
  });

  it('does not expose tool step detail (arguments and results) in the public step view', async () => {
    const t = await setupOwnerWithWorkspace(app, principals);
    const agentId = await agentWithWriteTool(t);
    const { runId } = await startWaitingRun(t, t.owner.id, agentId);
    const detail = await send(t.owner.id, 'GET', `${ws(t)}/runs/${runId}`);
    for (const step of detail.body.steps) expect(step).not.toHaveProperty('detail');
    expect(detail.body.steps.map((s: { status: string }) => s.status)).toContain('awaiting_approval');
  });
});
