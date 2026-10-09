/** Where an answer's evidence came from: identity and location only, never the text or the query. */
export interface RunSource {
  readonly stepSequence: number;
  readonly evidenceId: string;
  readonly title: string;
  readonly section: string | null;
  readonly ordinal: number;
}

interface StepLike {
  readonly sequence: number;
  readonly type: string;
  readonly status: string;
  readonly detail: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSource(stepSequence: number, passage: unknown): RunSource | undefined {
  if (!isRecord(passage)) return undefined;
  const { evidenceId, title, section, ordinal } = passage;
  if (typeof evidenceId !== 'string' || !UUID.test(evidenceId)) return undefined;
  if (typeof title !== 'string') return undefined;
  if (typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 0) return undefined;
  return { stepSequence, evidenceId, title, section: typeof section === 'string' ? section : null, ordinal };
}

/**
 * The knowledge a run actually read, taken from its completed
 * `search_knowledge` steps. The run record keeps the passages for traceability
 * (ADR-014); this is the part that is safe to show next to the answer.
 * Anything malformed is skipped rather than guessed.
 */
export function extractSources(steps: readonly StepLike[]): RunSource[] {
  const sources: RunSource[] = [];
  for (const step of steps) {
    if (step.type !== 'tool_call' || step.status !== 'completed' || !isRecord(step.detail)) continue;
    if (step.detail.tool !== 'search_knowledge' || step.detail.outcome !== 'executed') continue;
    const result = step.detail.result;
    if (!isRecord(result) || !Array.isArray(result.results)) continue;
    for (const passage of result.results) {
      const source = toSource(step.sequence, passage);
      if (source) sources.push(source);
    }
  }
  return sources;
}
