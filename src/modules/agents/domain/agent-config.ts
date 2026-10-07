import { z } from 'zod';
import { MODEL_CAPABILITIES, QUALITY_TIERS, type ModelPolicy } from '../../models/domain/model-policy.js';

/**
 * Typed contracts for the agent configuration that was opaque JSON until the
 * Model Gateway existed. Both schemas are strict: an unknown key is an error,
 * so a typo can never silently disable a guardrail.
 */

const providerName = z.string().min(1).max(100);

const modelPolicySchema = z
  .object({
    requiredCapabilities: z.array(z.enum(MODEL_CAPABILITIES)).optional(),
    qualityTier: z.enum(QUALITY_TIERS).optional(),
    allowedProviders: z.array(providerName).optional(),
    disallowedProviders: z.array(providerName).optional(),
    maxCostPerRunUsd: z.number().finite().nonnegative().optional(),
    fallbackAllowed: z.boolean().optional(),
  })
  .strict();

/** Hard ceilings an agent author cannot raise; they bound cost and latency of a single run. */
export const RUN_LIMIT_CEILINGS = { maxOutputTokens: 4096, timeoutMs: 60_000 } as const;
export const DEFAULT_RUN_LIMITS = { maxOutputTokens: 1024, timeoutMs: 30_000 } as const;
const MIN_TIMEOUT_MS = 1000;

const guardrailsSchema = z
  .object({
    maxOutputTokens: z.number().int().min(1).max(RUN_LIMIT_CEILINGS.maxOutputTokens).optional(),
    timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(RUN_LIMIT_CEILINGS.timeoutMs).optional(),
  })
  .strict();

export interface RunLimits {
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

/** Issue text names the field and the rule (the zod code), never the offending value. */
function failure(error: z.ZodError): { ok: false; issues: string[] } {
  return {
    ok: false,
    issues: error.issues.map((issue) => {
      const where = issue.path.join('.') || '(root)';
      return issue.code === 'unrecognized_keys'
        ? `${where}: unrecognized key(s) ${issue.keys.join(', ')}`
        : `${where}: ${issue.code}`;
    }),
  };
}

export function parseModelPolicy(raw: unknown): ParseResult<ModelPolicy> {
  const parsed = modelPolicySchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data as ModelPolicy } : failure(parsed.error);
}

export function parseGuardrails(raw: unknown): ParseResult<RunLimits> {
  const parsed = guardrailsSchema.safeParse(raw);
  if (!parsed.success) return failure(parsed.error);
  return {
    ok: true,
    value: {
      maxOutputTokens: parsed.data.maxOutputTokens ?? DEFAULT_RUN_LIMITS.maxOutputTokens,
      timeoutMs: parsed.data.timeoutMs ?? DEFAULT_RUN_LIMITS.timeoutMs,
    },
  };
}
