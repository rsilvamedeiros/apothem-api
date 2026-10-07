import type { NewRun, NewRunStep, Run, RunStep } from '../infrastructure/schema.js';
import type { RunStatus } from '../domain/run-state.js';

export interface RunFilter {
  readonly agentId?: string | undefined;
  readonly requestedByPrincipalId?: string | undefined;
}

export interface RunPageRequest {
  /** Already clamped by the service. */
  readonly limit: number;
  readonly after?: { readonly createdAt: Date; readonly id: string } | undefined;
}

/** Fields a transition may set; everything else on a run is immutable after creation. */
export type RunPatch = Partial<
  Pick<
    Run,
    | 'startedAt'
    | 'finishedAt'
    | 'output'
    | 'errorCode'
    | 'errorMessage'
    | 'modelProvider'
    | 'model'
    | 'inputTokens'
    | 'outputTokens'
  >
>;

/**
 * Every query is scoped by workspace. There is deliberately no generic update
 * and no delete: a run only moves along the state machine through `advance`.
 */
export interface RunPort {
  create(input: NewRun): Promise<Run>;
  findById(workspaceId: string, runId: string): Promise<Run | undefined>;
  findByIdempotencyKey(workspaceId: string, key: string): Promise<Run | undefined>;
  list(workspaceId: string, filter: RunFilter, page: RunPageRequest): Promise<Run[]>;
  /**
   * Compare-and-set: applies `to` and `patch` only if the run is still in
   * `from`. Returns `undefined` when another writer already moved it, so a
   * late result can never overwrite a terminal run.
   */
  advance(workspaceId: string, runId: string, from: RunStatus, to: RunStatus, patch?: RunPatch): Promise<Run | undefined>;
}

export interface RunStepPort {
  create(input: NewRunStep): Promise<RunStep>;
  listByRun(runId: string): Promise<RunStep[]>;
}
