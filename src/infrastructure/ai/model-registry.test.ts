import { describe, expect, it } from 'vitest';
import { buildModelRouter } from './model-registry.js';
import { loadEnv } from '../http/env.js';
import { ModelPolicyNoRouteError } from '../../modules/models/domain/model-error.js';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused/unused',
  REDIS_URL: 'redis://unused',
  STORAGE_ENDPOINT: 'http://unused',
  STORAGE_ACCESS_KEY_ID: 'unused',
  STORAGE_SECRET_ACCESS_KEY: 'unused',
  STORAGE_BUCKET: 'unused',
  AUTH_SECRET: 'unused-secret-value',
};

describe('buildModelRouter', () => {
  it('resolves every policy to the mock adapter when no provider API key is configured', async () => {
    const router = buildModelRouter(loadEnv(baseEnv));
    const result = await router.generate(
      {},
      { systemInstructions: 'sys', messages: [{ role: 'user', content: 'hi' }] },
    );
    expect(result.provider).toBe('mock');
  });

  it('still resolves an explicit provider: ["mock"] policy the same way', () => {
    const router = buildModelRouter(loadEnv(baseEnv));
    expect(router.selectRoute({ allowedProviders: ['mock'] }).provider).toBe('mock');
  });

  it('has no route for a provider that was never configured', () => {
    const router = buildModelRouter(loadEnv(baseEnv));
    expect(() => router.selectRoute({ allowedProviders: ['anthropic'] })).toThrow(ModelPolicyNoRouteError);
  });

  it('prefers the anthropic route over mock when ANTHROPIC_API_KEY is set', () => {
    const router = buildModelRouter(loadEnv({ ...baseEnv, ANTHROPIC_API_KEY: 'sk-test-unused' }));
    expect(router.selectRoute({}).provider).toBe('anthropic');
  });

  it('prices the mock route at zero so budgeted policies still resolve in tests and CI', () => {
    const router = buildModelRouter(loadEnv(baseEnv));
    expect(router.selectRoute({ maxCostPerRunUsd: 0 }).provider).toBe('mock');
  });

  it('fails closed under a budget for a provider whose pricing is not configured', () => {
    const router = buildModelRouter(loadEnv({ ...baseEnv, ANTHROPIC_API_KEY: 'sk-test-unused' }));
    expect(router.selectRoute({ maxCostPerRunUsd: 1 }).provider).toBe('mock');
    expect(() => router.selectRoute({ allowedProviders: ['anthropic'], maxCostPerRunUsd: 1 })).toThrow(
      ModelPolicyNoRouteError,
    );
  });
});
