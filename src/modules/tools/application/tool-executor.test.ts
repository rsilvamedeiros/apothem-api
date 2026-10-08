import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInToolExecutor, MAX_TOOL_RESULT_LENGTH } from './tool-executor.js';
import type { KnowledgeRetrieverPort } from '../../knowledge/application/knowledge-retriever.js';
import type { KnowledgeEvidence } from '../../knowledge/application/knowledge.port.js';
import { FakeNoteRepository } from '../../../infrastructure/http/__fixtures__/fake-repositories.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

const context = { organizationId: ORG, workspaceId: WORKSPACE, principalId: PRINCIPAL, runId: RUN, knowledgeBaseIds: [] as string[] };

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

  describe('search_knowledge', () => {
    const BASE = '66666666-6666-4666-8666-666666666666';
    const evidenceOf = (overrides: Partial<KnowledgeEvidence> = {}): KnowledgeEvidence => ({
      chunkId: crypto.randomUUID(),
      knowledgeBaseId: BASE,
      documentId: crypto.randomUUID(),
      documentTitle: 'Refund policy',
      ordinal: 2,
      section: 'Refunds',
      text: 'Refunds take five days.',
      score: 1,
      ...overrides,
    });
    const withRetriever = (results: KnowledgeEvidence[]) => {
      const retrieve = vi.fn<KnowledgeRetrieverPort['retrieve']>(async () => results);
      return { retrieve, executor: new BuiltInToolExecutor(notes, () => now, { retrieve }) };
    };
    const scoped = { ...context, knowledgeBaseIds: [BASE] };

    it('asks the retriever with the scope of the run, never with ids from the arguments', async () => {
      const { retrieve, executor: searching } = withRetriever([]);
      await searching.execute(scoped, 'search_knowledge', { query: 'refund policy' }, 'k');
      expect(retrieve).toHaveBeenCalledWith({ workspaceId: WORKSPACE, knowledgeBaseIds: [BASE], query: 'refund policy' });
    });

    it('returns each passage with its source identity and nothing else about the document', async () => {
      const item = evidenceOf();
      const { executor: searching } = withRetriever([item]);
      expect(await searching.execute(scoped, 'search_knowledge', { query: 'refund' }, 'k')).toEqual({
        ok: true,
        result: { results: [{ evidenceId: item.chunkId, title: 'Refund policy', section: 'Refunds', ordinal: 2, text: 'Refunds take five days.' }] },
      });
    });

    it('returns an empty list, not a failure, when nothing matches', async () => {
      const { executor: searching } = withRetriever([]);
      expect(await searching.execute(scoped, 'search_knowledge', { query: 'nothing' }, 'k')).toEqual({ ok: true, result: { results: [] } });
    });

    it('keeps a missing section as null and shortens long titles and sections', async () => {
      const { executor: searching } = withRetriever([evidenceOf({ section: null }), evidenceOf({ documentTitle: 't'.repeat(200), section: 's'.repeat(200), text: 'short' })]);
      const outcome = await searching.execute(scoped, 'search_knowledge', { query: 'x' }, 'k');
      const results = (outcome.ok ? outcome.result.results : []) as { title: string; section: string | null }[];
      expect(results[0]!.section).toBeNull();
      expect(results[1]!.title).toHaveLength(50);
      expect(results[1]!.section).toHaveLength(40);
    });

    it('always fits the tool result limit, trimming the longest text first and keeping valid JSON', async () => {
      const heavy = (n: number) => evidenceOf({ documentTitle: 'T'.repeat(60), section: 'S'.repeat(60), text: `"line"\n`.repeat(70).slice(0, 500) + n });
      const { executor: searching } = withRetriever([heavy(1), heavy(2), heavy(3)]);
      const outcome = await searching.execute(scoped, 'search_knowledge', { query: 'x' }, 'k');
      expect(outcome.ok).toBe(true);
      const serialized = JSON.stringify(outcome.ok && outcome.result);
      expect(serialized.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_LENGTH);
      const results = (outcome.ok ? outcome.result.results : []) as { evidenceId: string; text: string }[];
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.text.endsWith('…') || r.text.length < 500)).toBe(true);
    });

    it('leaves a result that already fits untouched', async () => {
      const items = [evidenceOf({ text: 'a'.repeat(400) }), evidenceOf({ text: 'b'.repeat(400) })];
      const { executor: searching } = withRetriever(items);
      const outcome = await searching.execute(scoped, 'search_knowledge', { query: 'x' }, 'k');
      expect((outcome.ok ? outcome.result.results : []) as { text: string }[]).toEqual([
        expect.objectContaining({ text: 'a'.repeat(400) }),
        expect.objectContaining({ text: 'b'.repeat(400) }),
      ]);
    });

    it('drops the least relevant passages when even trimmed texts cannot fit', async () => {
      const crowded = Array.from({ length: 12 }, () => evidenceOf({ documentTitle: 'T'.repeat(60), section: 'S'.repeat(60), text: 'x'.repeat(300) }));
      const { executor: searching } = withRetriever(crowded);
      const outcome = await searching.execute(scoped, 'search_knowledge', { query: 'x' }, 'k');
      const results = (outcome.ok ? outcome.result.results : []) as { evidenceId: string }[];
      expect(JSON.stringify(outcome.ok && outcome.result).length).toBeLessThanOrEqual(MAX_TOOL_RESULT_LENGTH);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThan(12);
      expect(results[0]!.evidenceId).toBe(crowded[0]!.chunkId);
    });

    it('fails closed when no retriever is configured, and when retrieval itself fails', async () => {
      expect(await executor.execute(scoped, 'search_knowledge', { query: 'x' }, 'k')).toEqual({ ok: false });
      const broken = new BuiltInToolExecutor(notes, () => now, {
        retrieve: async () => {
          throw new Error('db at 10.0.0.5 refused');
        },
      });
      expect(await broken.execute(scoped, 'search_knowledge', { query: 'x' }, 'k')).toEqual({ ok: false });
    });
  });

  it('keeps results small enough to hand back to the model', async () => {
    const outcome = await executor.execute(context, 'create_note', { title: 'T', body: 'B' }, 'k');
    expect(JSON.stringify(outcome.ok && outcome.result).length).toBeLessThanOrEqual(MAX_TOOL_RESULT_LENGTH);
  });
});
