import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../infrastructure/http/server.js';
import { testEnv } from '../../../infrastructure/http/__fixtures__/http-test-harness.js';
import { createTestDatabase, type TestDatabase } from '../../../infrastructure/database/__fixtures__/test-database.js';
import { PrincipalRepository } from '../../identity/infrastructure/principal.repository.js';
import { RunRepository, RunStepRepository } from './run.repository.js';
import { runs } from './schema.js';

/** Runs on the real schema: durable records, compare-and-set transitions, unique idempotency keys. */
describe('runs on real Postgres (integration)', () => {
  let database: TestDatabase;
  let app: FastifyInstance;
  let principals: PrincipalRepository;
  let runRepository: RunRepository;
  let stepRepository: RunStepRepository;

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await buildServer(testEnv, database.db);
    await app.ready();
    principals = new PrincipalRepository(database.db);
    runRepository = new RunRepository(database.db);
    stepRepository = new RunStepRepository(database.db);
  });

  afterAll(async () => {
    await app.close();
    await database.close();
  });

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
    const principal = await principals.create({ type: 'user', email: `${label}@example.com`, name: label });
    const org = (await call(principal.id, 'POST', '/v1/organizations', { name: label, slug: label })).body;
    const workspace = (await call(principal.id, 'POST', `/v1/organizations/${org.id}/workspaces`, { name: 'Main', slug: 'main' })).body;
    const base = `/v1/organizations/${org.id}/workspaces/${workspace.id}`;
    const agent = (await call(principal.id, 'POST', `${base}/agents`, { name: 'Bot', slug: 'bot' })).body.agent;
    await call(principal.id, 'PATCH', `${base}/agents/${agent.id}/draft`, {
      instructions: 'Be brief.',
      modelPolicy: { allowedProviders: ['mock'] },
      guardrails: { maxOutputTokens: 200 },
    });
    const version = (await call(principal.id, 'POST', `${base}/agents/${agent.id}/publish`)).body;
    return { principal, org, workspace, base, agent, version };
  }

  it('persists a completed run with its pinned version, usage and a model step', async () => {
    const t = await bootstrap('persist');
    const started = await call(t.principal.id, 'POST', `${t.base}/agents/${t.agent.id}/runs`, { input: 'hello world' });
    expect(started.status).toBe(201);

    const [row] = await database.db.select().from(runs).where(eq(runs.id, started.body.run.id));
    expect(row).toMatchObject({
      status: 'completed',
      agentVersionId: t.version.id,
      requestedByPrincipalId: t.principal.id,
      input: { text: 'hello world' },
      output: { text: 'Mock response to: hello world' },
      modelProvider: 'mock',
      errorCode: null,
    });
    expect(row?.startedAt).toBeInstanceOf(Date);
    expect(row?.finishedAt).toBeInstanceOf(Date);
    expect(row!.finishedAt!.getTime()).toBeGreaterThanOrEqual(row!.startedAt!.getTime());

    const steps = await stepRepository.listByRun(row!.id);
    expect(steps).toEqual([expect.objectContaining({ sequence: 1, type: 'model_call', status: 'completed', model: 'mock-1' })]);
  });

  it('survives two identical requests arriving together with exactly one run', async () => {
    const t = await bootstrap('parallel');
    const url = `${t.base}/agents/${t.agent.id}/runs`;
    const responses = await Promise.all(
      [1, 2, 3].map(() => call(t.principal.id, 'POST', url, { input: 'same', idempotencyKey: 'once' })),
    );

    expect(responses.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(responses.map((r) => r.body.run.id)).size).toBe(1);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    const listed = await call(t.principal.id, 'GET', `${t.base}/runs`);
    expect(listed.body.runs).toHaveLength(1);
  });

  it('never rewrites a terminal run: advance is compare-and-set on the stored state', async () => {
    const t = await bootstrap('terminal');
    const started = await call(t.principal.id, 'POST', `${t.base}/agents/${t.agent.id}/runs`, { input: 'x' });
    const runId = started.body.run.id as string;

    expect(await runRepository.advance(t.workspace.id, runId, 'running', 'failed', { errorCode: 'RUN_INTERNAL_ERROR' })).toBeUndefined();
    expect(await runRepository.advance(t.workspace.id, runId, 'completed', 'failed')).toBeDefined();
  });

  it('scopes every lookup by workspace', async () => {
    const a = await bootstrap('scope-a');
    const b = await bootstrap('scope-b');
    const run = (await call(a.principal.id, 'POST', `${a.base}/agents/${a.agent.id}/runs`, { input: 'secret' })).body.run;

    expect(await runRepository.findById(a.workspace.id, run.id)).toBeDefined();
    expect(await runRepository.findById(b.workspace.id, run.id)).toBeUndefined();
    expect(await runRepository.advance(b.workspace.id, run.id, 'completed', 'failed')).toBeUndefined();
    expect(await runRepository.list(b.workspace.id, {}, { limit: 10 })).toEqual([]);
  });

  it('pages runs with a keyset cursor over the real query', async () => {
    const t = await bootstrap('paging');
    for (let n = 1; n <= 5; n += 1) {
      await call(t.principal.id, 'POST', `${t.base}/agents/${t.agent.id}/runs`, { input: `run ${n}` });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 6; guard += 1) {
      const page: { body: Record<string, any> } = await call(
        t.principal.id,
        'GET',
        `${t.base}/runs?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      seen.push(...page.body.runs.map((r: { input: { text: string } }) => r.input.text));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(['run 5', 'run 4', 'run 3', 'run 2', 'run 1']);
  });

  it('keeps history when an agent is archived: the run and its version stay readable', async () => {
    const t = await bootstrap('history');
    const run = (await call(t.principal.id, 'POST', `${t.base}/agents/${t.agent.id}/runs`, { input: 'keep me' })).body.run;
    await call(t.principal.id, 'POST', `${t.base}/agents/${t.agent.id}/archive`);

    const detail = await call(t.principal.id, 'GET', `${t.base}/runs/${run.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.run.agentVersionId).toBe(t.version.id);
    expect((await call(t.principal.id, 'POST', `${t.base}/agents/${t.agent.id}/runs`, { input: 'again' })).status).toBe(409);
  });
});
