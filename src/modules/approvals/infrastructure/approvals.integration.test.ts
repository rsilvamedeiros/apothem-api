import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../infrastructure/http/server.js';
import { testEnv } from '../../../infrastructure/http/__fixtures__/http-test-harness.js';
import { createTestDatabase, type TestDatabase } from '../../../infrastructure/database/__fixtures__/test-database.js';
import { PrincipalRepository } from '../../identity/infrastructure/principal.repository.js';
import { ApprovalRepository } from './approval.repository.js';
import { approvals } from './schema.js';
import { workspaceNotes } from '../../tools/infrastructure/schema.js';
import { runSteps, runs } from '../../runs/infrastructure/schema.js';

const WRITE = '__mock_tool_call__ create_note {"title":"Call back","body":"Tomorrow 10am"}';

/** The approval path on the real schema: durable proposals, one decision, idempotent writes. */
describe('approvals and tools on real Postgres (integration)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let principals: PrincipalRepository;
  let approvalRepository: ApprovalRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildServer(testEnv, database.db);
    await app.ready();
    principals = new PrincipalRepository(database.db);
    approvalRepository = new ApprovalRepository(database.db);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

  async function call(principalId: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) {
    const response = await app.inject({ method, url, headers: { 'x-principal-id': principalId }, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: response.json() as Record<string, any> };
  }

  async function bootstrap(label: string) {
    const owner = await principals.create({ type: 'user', email: `${label}@example.com`, name: label });
    const org = (await call(owner.id, 'POST', '/v1/organizations', { name: label, slug: label })).body;
    const workspace = (await call(owner.id, 'POST', `/v1/organizations/${org.id}/workspaces`, { name: 'Main', slug: 'main' })).body;
    const base = `/v1/organizations/${org.id}/workspaces/${workspace.id}`;
    const agent = (await call(owner.id, 'POST', `${base}/agents`, { name: 'Notes', slug: 'notes' })).body.agent;
    await call(owner.id, 'PATCH', `${base}/agents/${agent.id}/draft`, {
      instructions: 'Save notes when asked.',
      modelPolicy: { allowedProviders: ['mock'] },
      toolBindings: [{ tool: 'create_note', approval: 'required' }],
    });
    await call(owner.id, 'POST', `${base}/agents/${agent.id}/publish`);
    return { owner, org, workspace, base, agent };
  }

  it('persists the proposal, executes it once on approval and writes the note with provenance', async () => {
    const t = await bootstrap('flow');
    const started = await call(t.owner.id, 'POST', `${t.base}/agents/${t.agent.id}/runs`, { input: WRITE });
    expect(started.body.run.status).toBe('waiting_approval');

    const [pending] = await database.db.select().from(approvals).where(eq(approvals.runId, started.body.run.id));
    expect(pending).toMatchObject({
      status: 'pending',
      toolName: 'create_note',
      arguments: { title: 'Call back', body: 'Tomorrow 10am' },
      requestedByPrincipalId: t.owner.id,
      workspaceId: t.workspace.id,
    });
    expect(await database.db.select().from(workspaceNotes).where(eq(workspaceNotes.workspaceId, t.workspace.id))).toEqual([]);

    const decided = await call(t.owner.id, 'POST', `${t.base}/approvals/${pending!.id}/decision`, { decision: 'approve' });
    expect(decided.status).toBe(200);
    expect(decided.body.run.status).toBe('completed');

    const notes = await database.db.select().from(workspaceNotes).where(eq(workspaceNotes.workspaceId, t.workspace.id));
    expect(notes).toEqual([
      expect.objectContaining({
        title: 'Call back',
        body: 'Tomorrow 10am',
        createdByPrincipalId: t.owner.id,
        createdByRunId: started.body.run.id,
        idempotencyKey: `approval:${pending!.id}`,
        deletedAt: null,
      }),
    ]);

    const steps = await database.db.select().from(runSteps).where(eq(runSteps.runId, started.body.run.id));
    expect(steps.map((s) => [s.sequence, s.type, s.status]).sort()).toEqual([
      [1, 'model_call', 'completed'],
      [2, 'tool_call', 'awaiting_approval'],
      [3, 'tool_call', 'completed'],
      [4, 'model_call', 'completed'],
    ]);
  });

  it('lets exactly one of several simultaneous decisions win and writes a single note', async () => {
    const t = await bootstrap('race');
    const started = await call(t.owner.id, 'POST', `${t.base}/agents/${t.agent.id}/runs`, { input: WRITE });
    const [pending] = await database.db.select().from(approvals).where(eq(approvals.runId, started.body.run.id));

    const responses = await Promise.all(
      [1, 2, 3].map(() => call(t.owner.id, 'POST', `${t.base}/approvals/${pending!.id}/decision`, { decision: 'approve' })),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await database.db.select().from(workspaceNotes).where(eq(workspaceNotes.workspaceId, t.workspace.id))).toHaveLength(1);
  });

  it('refuses to open a second pending proposal for the same run', async () => {
    const t = await bootstrap('single-pending');
    const started = await call(t.owner.id, 'POST', `${t.base}/agents/${t.agent.id}/runs`, { input: WRITE });
    const [pending] = await database.db.select().from(approvals).where(eq(approvals.runId, started.body.run.id));

    await expect(
      approvalRepository.create({
        organizationId: pending!.organizationId,
        workspaceId: pending!.workspaceId,
        agentId: pending!.agentId,
        runId: pending!.runId,
        stepSequence: 99,
        toolName: 'create_note',
        arguments: {},
        requestedByPrincipalId: pending!.requestedByPrincipalId,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();
  });

  it('scopes every approval lookup by workspace and decides only out of pending', async () => {
    const a = await bootstrap('scope-a');
    const b = await bootstrap('scope-b');
    const started = await call(a.owner.id, 'POST', `${a.base}/agents/${a.agent.id}/runs`, { input: WRITE });
    const [pending] = await database.db.select().from(approvals).where(eq(approvals.runId, started.body.run.id));

    expect(await approvalRepository.findById(a.workspace.id, pending!.id)).toBeDefined();
    expect(await approvalRepository.findById(b.workspace.id, pending!.id)).toBeUndefined();
    expect(await approvalRepository.list(b.workspace.id, {}, { limit: 10 })).toEqual([]);
    expect(await approvalRepository.decide(b.workspace.id, pending!.id, { status: 'approved', decidedAt: new Date() })).toBeUndefined();

    const decided = await approvalRepository.decide(a.workspace.id, pending!.id, { status: 'rejected', decidedAt: new Date() });
    expect(decided?.status).toBe('rejected');
    expect(await approvalRepository.decide(a.workspace.id, pending!.id, { status: 'approved', decidedAt: new Date() })).toBeUndefined();
  });

  it('keeps the run, its steps and the approval as history after the agent is archived', async () => {
    const t = await bootstrap('history');
    const started = await call(t.owner.id, 'POST', `${t.base}/agents/${t.agent.id}/runs`, { input: WRITE });
    const [pending] = await database.db.select().from(approvals).where(eq(approvals.runId, started.body.run.id));
    await call(t.owner.id, 'POST', `${t.base}/agents/${t.agent.id}/archive`);

    const attempt = await call(t.owner.id, 'POST', `${t.base}/approvals/${pending!.id}/decision`, { decision: 'approve' });
    expect(attempt.status).toBe(409);

    const [run] = await database.db.select().from(runs).where(eq(runs.id, started.body.run.id));
    expect(run).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_INVALIDATED' });
    expect(await database.db.select().from(workspaceNotes).where(eq(workspaceNotes.workspaceId, t.workspace.id))).toEqual([]);
    expect((await approvalRepository.findById(t.workspace.id, pending!.id))?.status).toBe('rejected');
  });
});
