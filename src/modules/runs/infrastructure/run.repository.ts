import { and, asc, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { Database } from '../../../infrastructure/database/client.js';
import type { RunFilter, RunPageRequest, RunPatch, RunPort, RunStepPort } from '../application/run.port.js';
import type { RunStatus } from '../domain/run-state.js';
import { runSteps, runs, type NewRun, type NewRunStep, type Run, type RunStep } from './schema.js';

export class RunRepository implements RunPort {
  constructor(private readonly db: Database) {}

  async create(input: NewRun): Promise<Run> {
    const [row] = await this.db.insert(runs).values(input).returning();
    if (!row) {
      throw new Error('Failed to create run');
    }
    return row;
  }

  async findById(workspaceId: string, runId: string): Promise<Run | undefined> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId)))
      .limit(1);
    return row;
  }

  async findByIdempotencyKey(workspaceId: string, key: string): Promise<Run | undefined> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.workspaceId, workspaceId), eq(runs.idempotencyKey, key)))
      .limit(1);
    return row;
  }

  async list(workspaceId: string, filter: RunFilter, page: RunPageRequest): Promise<Run[]> {
    // The workspace predicate is unconditional; every other condition only narrows it.
    const conditions: SQL[] = [eq(runs.workspaceId, workspaceId)];
    if (filter.agentId) conditions.push(eq(runs.agentId, filter.agentId));
    if (filter.requestedByPrincipalId) conditions.push(eq(runs.requestedByPrincipalId, filter.requestedByPrincipalId));
    if (page.after) {
      const keyset = or(
        lt(runs.createdAt, page.after.createdAt),
        and(eq(runs.createdAt, page.after.createdAt), lt(runs.id, page.after.id)),
      );
      if (keyset) conditions.push(keyset);
    }
    return this.db
      .select()
      .from(runs)
      .where(and(...conditions))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(page.limit);
  }

  async advance(
    workspaceId: string,
    runId: string,
    from: RunStatus,
    to: RunStatus,
    patch: RunPatch = {},
  ): Promise<Run | undefined> {
    const [row] = await this.db
      .update(runs)
      .set({ ...patch, status: to })
      .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId), eq(runs.status, from)))
      .returning();
    return row;
  }
}

export class RunStepRepository implements RunStepPort {
  constructor(private readonly db: Database) {}

  async create(input: NewRunStep): Promise<RunStep> {
    const [row] = await this.db.insert(runSteps).values(input).returning();
    if (!row) {
      throw new Error('Failed to create run step');
    }
    return row;
  }

  async listByRun(runId: string): Promise<RunStep[]> {
    return this.db.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.sequence));
  }
}
