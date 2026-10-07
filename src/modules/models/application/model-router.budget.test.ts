import { describe, expect, it } from 'vitest';
import { ModelRouter } from './model-router.js';
import { ModelPolicyNoRouteError } from '../domain/model-error.js';
import type { GenerateRequest, ModelAdapter } from './model-gateway.port.js';
import type { ModelRoute } from './model-route.js';
import { MockModelAdapter } from '../../../infrastructure/ai/mock-model.adapter.js';

const mock = new MockModelAdapter();

const FREE_MOCK: ModelRoute = {
  provider: 'mock',
  model: 'mock-1',
  qualityTier: 'standard',
  capabilities: mock.capabilities,
  pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
};

const PAID: ModelRoute = {
  provider: 'paid',
  model: 'paid-1',
  qualityTier: 'premium',
  capabilities: mock.capabilities,
  pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
};

const UNPRICED: ModelRoute = {
  provider: 'unpriced',
  model: 'unpriced-1',
  qualityTier: 'premium',
  capabilities: mock.capabilities,
};

function adapterFor(provider: string): ModelAdapter {
  return {
    provider,
    qualityTier: 'standard',
    capabilities: mock.capabilities,
    generate: async (model) => ({
      provider,
      model,
      output: { type: 'text', text: 'ok' },
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: 'stop',
    }),
  };
}

function router(routes: ModelRoute[]): ModelRouter {
  return new ModelRouter(new Map(routes.map((r) => [r.provider, adapterFor(r.provider)])), routes);
}

const SMALL: GenerateRequest = {
  systemInstructions: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
  maxOutputTokens: 100,
};

describe('ModelRouter — maxCostPerRunUsd guardrail', () => {
  it('ignores cost when the policy sets no budget', () => {
    expect(router([UNPRICED]).selectRoute({}, SMALL).provider).toBe('unpriced');
  });

  it('skips routes that cannot be priced when a budget is set (fails closed)', () => {
    const selected = router([UNPRICED, FREE_MOCK]).selectRoute({ maxCostPerRunUsd: 1 }, SMALL);
    expect(selected.provider).toBe('mock');
  });

  it('rejects the run when only unpriced routes exist and a budget is set', () => {
    expect(() => router([UNPRICED]).selectRoute({ maxCostPerRunUsd: 1 }, SMALL)).toThrow(ModelPolicyNoRouteError);
  });

  it('skips a route whose worst-case cost exceeds the budget and picks a cheaper one', () => {
    const big: GenerateRequest = { ...SMALL, maxOutputTokens: 100_000 };
    // paid worst case: 100k output tokens * $15/M = $1.50 (> $1.00 budget)
    const selected = router([PAID, FREE_MOCK]).selectRoute({ maxCostPerRunUsd: 1 }, big);
    expect(selected.provider).toBe('mock');
  });

  it('accepts a route whose worst-case cost fits the budget, preferring catalog order', () => {
    const selected = router([PAID, FREE_MOCK]).selectRoute({ maxCostPerRunUsd: 1 }, SMALL);
    expect(selected.provider).toBe('paid');
  });

  it('counts input tokens as well as the output cap', () => {
    const hugeInput: GenerateRequest = {
      systemInstructions: 'x'.repeat(4_000_000), // about 1M input tokens, $3 on the paid route
      messages: [{ role: 'user', content: 'hi' }],
      maxOutputTokens: 1,
    };
    expect(router([PAID]).selectRoute({ maxCostPerRunUsd: 5 }, hugeInput).provider).toBe('paid');
    expect(() => router([PAID]).selectRoute({ maxCostPerRunUsd: 2 }, hugeInput)).toThrow(ModelPolicyNoRouteError);
  });

  it('assumes the default output cap when the request sets none', () => {
    const noCap: GenerateRequest = { systemInstructions: '', messages: [] };
    // 1024 default output tokens * $15/M = about $0.0154
    expect(router([PAID]).selectRoute({ maxCostPerRunUsd: 0.02 }, noCap).provider).toBe('paid');
    expect(() => router([PAID]).selectRoute({ maxCostPerRunUsd: 0.01 }, noCap)).toThrow(ModelPolicyNoRouteError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY * -1])('rejects an invalid budget (%s)', (budget) => {
    expect(() => router([FREE_MOCK]).selectRoute({ maxCostPerRunUsd: budget }, SMALL)).toThrow(
      ModelPolicyNoRouteError,
    );
  });

  it('allows a zero budget only for free routes', () => {
    expect(router([PAID, FREE_MOCK]).selectRoute({ maxCostPerRunUsd: 0 }, SMALL).provider).toBe('mock');
  });

  it('enforces the budget on generate() as well, before any provider call', async () => {
    await expect(router([PAID]).generate({ maxCostPerRunUsd: 0 }, SMALL)).rejects.toThrow(ModelPolicyNoRouteError);
  });
});
