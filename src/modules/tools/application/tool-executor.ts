import { getToolDefinition } from '../domain/tool-catalog.js';
import type { KnowledgeRetrieverPort } from '../../knowledge/application/knowledge-retriever.js';
import type { NotePort } from './note.port.js';

export const MAX_TOOL_RESULT_LENGTH = 2000;

export interface ToolExecutionContext {
  readonly organizationId: string;
  readonly workspaceId: string;
  /** The person who started the run: writes are attributed to them, never to the model. */
  readonly principalId: string;
  readonly runId: string;
  /** The knowledge bases bound to the published agent version. Server-derived: the model never chooses or widens them. */
  readonly knowledgeBaseIds: readonly string[];
}

const EVIDENCE_TITLE_MAX = 50;
const EVIDENCE_SECTION_MAX = 40;
const MIN_SHRINKABLE_TEXT = 20;

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
    private readonly retriever?: KnowledgeRetrieverPort,
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
        case 'search_knowledge':
          return await this.searchKnowledge(context, args);
        default:
          return { ok: false };
      }
    } catch {
      return { ok: false };
    }
  }

  /**
   * Returns the best passages with their source identity. The result is
   * trimmed until it fits the tool result limit, so the model never receives
   * a structure cut in the middle (ADR-014).
   */
  private async searchKnowledge(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolOutcome> {
    if (!this.retriever) {
      return { ok: false };
    }
    const evidence = await this.retriever.retrieve({
      workspaceId: context.workspaceId,
      knowledgeBaseIds: context.knowledgeBaseIds,
      query: String(args.query),
    });

    const results = evidence.map((item) => ({
      evidenceId: item.chunkId,
      title: item.documentTitle.slice(0, EVIDENCE_TITLE_MAX),
      section: item.section === null ? null : item.section.slice(0, EVIDENCE_SECTION_MAX),
      ordinal: item.ordinal,
      text: item.text,
    }));
    while (results.length > 0 && JSON.stringify({ results }).length > MAX_TOOL_RESULT_LENGTH) {
      const longest = results.reduce((best, candidate) => (candidate.text.length > best.text.length ? candidate : best));
      if (longest.text.length <= MIN_SHRINKABLE_TEXT) {
        results.pop();
      } else {
        longest.text = `${longest.text.slice(0, Math.floor(longest.text.length * 0.8))}…`;
      }
    }
    return { ok: true, result: { results } };
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
