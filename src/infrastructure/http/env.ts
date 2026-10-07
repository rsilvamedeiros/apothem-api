import { z } from 'zod';

const MIN_HS256_SECRET_LENGTH = 32;

/**
 * Fails fast on boot rather than surfacing missing config as a runtime error
 * deep inside a request handler.
 */
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  /**
   * `dev` trusts an `x-principal-id` header verbatim (local development and
   * tests only). `jwt` verifies a signed bearer token. Production must use `jwt`.
   */
  AUTH_MODE: z.enum(['dev', 'jwt']).default('dev'),
  AUTH_JWT_ISSUER: z.string().min(1).optional(),
  AUTH_JWT_AUDIENCE: z.string().min(1).optional(),
  /** Asymmetric keys (RS256/ES256) from a self-hosted or external OIDC provider. Without it, HS256 with AUTH_SECRET is used. */
  AUTH_JWKS_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
});

const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && env.AUTH_MODE !== 'jwt') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AUTH_MODE'],
      message: 'production requires AUTH_MODE=jwt (the dev header authenticator performs no verification)',
    });
  }

  if (env.AUTH_MODE === 'jwt') {
    if (!env.AUTH_JWT_ISSUER) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_JWT_ISSUER'], message: 'required when AUTH_MODE=jwt' });
    }
    if (!env.AUTH_JWT_AUDIENCE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['AUTH_JWT_AUDIENCE'], message: 'required when AUTH_MODE=jwt' });
    }
    if (!env.AUTH_JWKS_URL && env.AUTH_SECRET.length < MIN_HS256_SECRET_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_SECRET'],
        message: `must be at least ${MIN_HS256_SECRET_LENGTH} characters for HS256 (or set AUTH_JWKS_URL)`,
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
