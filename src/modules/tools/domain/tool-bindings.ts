import { z } from 'zod';
import { listToolNames } from './tool-catalog.js';
import { APPROVAL_MODES, type ApprovalMode } from './tool-policy.js';

export const MAX_TOOL_BINDINGS = 5;

export interface ToolBinding {
  readonly tool: string;
  readonly approval: ApprovalMode;
}

export type ToolBindingsResult = { ok: true; value: ToolBinding[] } | { ok: false; issues: string[] };

/**
 * Strict contract for an agent version's `toolBindings` (ADR-013). Only
 * catalog tools can be bound, each at most once, and unknown keys are
 * rejected so a typo cannot silently change what an agent may do.
 */
const bindingSchema = z
  .object({
    tool: z.string().refine((name) => listToolNames().includes(name), { message: 'unknown tool' }),
    approval: z.enum(APPROVAL_MODES),
  })
  .strict();

const bindingsSchema = z
  .array(bindingSchema)
  .max(MAX_TOOL_BINDINGS)
  .superRefine((bindings, ctx) => {
    const seen = new Set<string>();
    for (const [index, binding] of bindings.entries()) {
      if (seen.has(binding.tool)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'tool'], message: 'duplicate tool' });
      }
      seen.add(binding.tool);
    }
  });

export function parseToolBindings(raw: unknown): ToolBindingsResult {
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
