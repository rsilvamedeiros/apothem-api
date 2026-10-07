import { beforeEach, describe, expect, it } from 'vitest';
import { BuiltInToolExecutor, MAX_TOOL_RESULT_LENGTH } from './tool-executor.js';
import { FakeNoteRepository } from '../../../infrastructure/http/__fixtures__/fake-repositories.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

const context = { organizationId: ORG, workspaceId: WORKSPACE, principalId: PRINCIPAL, runId: RUN };

describe('BuiltInToolExecutor', () => {
  let notes: FakeNoteRepository;
  let executor: BuiltInToolExecutor;
  const now = new Date('2026-03-04T05:06:07.000Z');

  beforeEach(() => {
    notes = new FakeNoteRepository();
    executor = new BuiltInToolExecutor(notes, () => now);
  });

  it('get_current_time returns the clock reading and has no side effect', async () => {
    const outcome = await executor.execute(context, 'get_current_time', {}, 'k-1');
    expect(outcome).toEqual({ ok: true, result: { now: '2026-03-04T05:06:07.000Z' } });
    expect(notes.rows).toHaveLength(0);
  });

  it('uses the real clock by default', async () => {
    const before = Date.now();
    const outcome = await new BuiltInToolExecutor(notes).execute(context, 'get_current_time', {}, 'k-clock');
    expect(outcome.ok).toBe(true);
    const reported = outcome.ok ? new Date(String(outcome.result.now)).getTime() : 0;
    expect(reported).toBeGreaterThanOrEqual(before);
    expect(reported).toBeLessThanOrEqual(Date.now());
  });

  it('create_note writes a note scoped to the run workspace and attributed to the requester', async () => {
    const outcome = await executor.execute(context, 'create_note', { title: 'Call back', body: 'Tomorrow 10am' }, 'k-2');
    expect(outcome.ok).toBe(true);
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0]).toMatchObject({
      organizationId: ORG,
      workspaceId: WORKSPACE,
      title: 'Call back',
      body: 'Tomorrow 10am',
      createdByPrincipalId: PRINCIPAL,
      createdByRunId: RUN,
      idempotencyKey: 'k-2',
      deletedAt: null,
    });
    expect(outcome).toMatchObject({ ok: true, result: { noteId: notes.rows[0]!.id } });
  });

  it('is idempotent: the same key never creates a second note and returns the same result', async () => {
    const first = await executor.execute(context, 'create_note', { title: 'T', body: 'B' }, 'same');
    const second = await executor.execute(context, 'create_note', { title: 'T', body: 'B' }, 'same');
    expect(notes.rows).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('recovers when two executions race on the same key', async () => {
    const racing = new FakeNoteRepository();
    const winner = await racing.create({
      organizationId: ORG,
      workspaceId: WORKSPACE,
      title: 'T',
      body: 'B',
      createdByPrincipalId: PRINCIPAL,
      idempotencyKey: 'race',
    });
    let looks = 0;
    const original = racing.findByIdempotencyKey.bind(racing);
    racing.findByIdempotencyKey = async (workspaceId: string, key: string) => (looks++ === 0 ? undefined : original(workspaceId, key));

    const outcome = await new BuiltInToolExecutor(racing, () => now).execute(context, 'create_note', { title: 'T', body: 'B' }, 'race');
    expect(outcome).toMatchObject({ ok: true, result: { noteId: winner.id } });
    expect(racing.rows).toHaveLength(1);
  });

  it('keys are scoped per workspace', async () => {
    await executor.execute(context, 'create_note', { title: 'T', body: 'B' }, 'k');
    await executor.execute({ ...context, workspaceId: '55555555-5555-4555-8555-555555555555' }, 'create_note', { title: 'T', body: 'B' }, 'k');
    expect(notes.rows).toHaveLength(2);
  });

  it('reports a tool outside the catalog as a failed execution without side effects', async () => {
    expect(await executor.execute(context, 'drop_database', {}, 'k')).toEqual({ ok: false });
    for (const forged of ['toString', 'constructor', '__proto__']) {
      expect(await executor.execute(context, forged, {}, 'k')).toEqual({ ok: false });
    }
    expect(notes.rows).toHaveLength(0);
  });

  it('reports a storage failure as a failed execution and never throws', async () => {
    const broken = new FakeNoteRepository();
    broken.create = async () => {
      throw new Error('connection refused to db at 10.0.0.5');
    };
    const outcome = await new BuiltInToolExecutor(broken, () => now).execute(context, 'create_note', { title: 'T', body: 'B' }, 'k');
    expect(outcome).toEqual({ ok: false });
  });

  it('keeps results small enough to hand back to the model', async () => {
    const outcome = await executor.execute(context, 'create_note', { title: 'T', body: 'B' }, 'k');
    expect(JSON.stringify(outcome.ok && outcome.result).length).toBeLessThanOrEqual(MAX_TOOL_RESULT_LENGTH);
  });
});
