import { getToolDefinition } from '../domain/tool-catalog.js';
import type { NotePort } from './note.port.js';

export const MAX_TOOL_RESULT_LENGTH = 2000;

export interface ToolExecutionContext {
  readonly organizationId: string;
  readonly workspaceId: string;
  /** The person who started the run: writes are attributed to them, never to the model. */
  readonly principalId: string;
  readonly runId: string;
}

/** Normalized outcome. Failure details are deliberately not carried: the runtime records a stable code only. */
export type ToolOutcome = { ok: true; result: Record<string, unknown> } | { ok: false };

export interface ToolExecutorPort {
  /**
   * Runs one already validated and authorized tool call. `idempotencyKey`
   * makes a retry or a resume safe: the same key never repeats a side effect.
   */
  execute(
    context: ToolExecutionContext,
    toolName: string,
    args: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<ToolOutcome>;
}

/** Handlers for the tools in the catalog. Arguments were validated against the tool schema upstream. */
export class BuiltInToolExecutor implements ToolExecutorPort {
  constructor(
    private readonly notes: NotePort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    context: ToolExecutionContext,
    toolName: string,
    args: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<ToolOutcome> {
    const definition = getToolDefinition(toolName);
    if (!definition) {
      return { ok: false };
    }

    try {
      switch (definition.name) {
        case 'get_current_time':
          return { ok: true, result: { now: this.clock().toISOString() } };
        case 'create_note':
          return await this.createNote(context, args, idempotencyKey);
        default:
          return { ok: false };
      }
    } catch {
      return { ok: false };
    }
  }

  private async createNote(
    context: ToolExecutionContext,
    args: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<ToolOutcome> {
    const existing = await this.notes.findByIdempotencyKey(context.workspaceId, idempotencyKey);
    if (existing) {
      return { ok: true, result: { noteId: existing.id } };
    }

    try {
      const note = await this.notes.create({
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        title: String(args.title),
        body: String(args.body),
        createdByPrincipalId: context.principalId,
        createdByRunId: context.runId,
        idempotencyKey,
      });
      return { ok: true, result: { noteId: note.id } };
    } catch (error) {
      // A concurrent execution with the same key may have won the unique index.
      const winner = await this.notes.findByIdempotencyKey(context.workspaceId, idempotencyKey);
      if (winner) {
        return { ok: true, result: { noteId: winner.id } };
      }
      throw error;
    }
  }
}
