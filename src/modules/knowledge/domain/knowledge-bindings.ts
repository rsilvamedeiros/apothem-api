import { z } from 'zod';

export const MAX_KNOWLEDGE_BINDINGS = 5;

export interface KnowledgeBinding {
  readonly knowledgeBaseId: string;
}

export type KnowledgeBindingsResult = { ok: true; value: KnowledgeBinding[] } | { ok: false; issues: string[] };

/**
 * Strict contract for an agent version's `knowledgeBindings` (ADR-014): the
 * knowledge bases the agent may search. Unknown keys are rejected so a typo
 * cannot silently widen or drop the scope. Whether a base exists in the
 * workspace is enforced at retrieval time, which is always tenant scoped.
 */
const bindingSchema = z.object({ knowledgeBaseId: z.string().uuid() }).strict();

const bindingsSchema = z
  .array(bindingSchema)
  .max(MAX_KNOWLEDGE_BINDINGS)
  .superRefine((bindings, ctx) => {
    const seen = new Set<string>();
    for (const [index, binding] of bindings.entries()) {
      if (seen.has(binding.knowledgeBaseId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'knowledgeBaseId'], message: 'duplicate knowledge base' });
      }
      seen.add(binding.knowledgeBaseId);
    }
  });

export function parseKnowledgeBindings(raw: unknown): KnowledgeBindingsResult {
  const parsed = bindingsSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  // Names the field and the rule, never the offending value.
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => {
      const where = issue.path.join('.') || '(root)';
      return issue.code === 'unrecognized_keys' ? `${where}: unrecognized key(s) ${issue.keys.join(', ')}` : `${where}: ${issue.code}${issue.code === 'custom' ? ` (${issue.message})` : ''}`;
    }),
  };
}
