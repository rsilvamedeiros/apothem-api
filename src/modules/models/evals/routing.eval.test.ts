import { describe, expect, it } from 'vitest';
import { ModelRouter } from '../application/model-router.js';
import { ModelPolicyNoRouteError } from '../domain/model-error.js';
import type { ModelAdapter } from '../application/model-gateway.port.js';
import type { ModelRoute } from '../application/model-route.js';
import { MODEL_CAPABILITIES } from '../domain/model-policy.js';
import { ROUTING_EVAL_CASES } from './routing.dataset.js';

const ALL = new Set(MODEL_CAPABILITIES);

const CATALOG: ModelRoute[] = [
  {
    provider: 'premium-co',
    model: 'big-1',
    qualityTier: 'premium',
    capabilities: new Set(['tool_calling', 'structured_output', 'long_context']),
    pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
  },
  { provider: 'vision-co', model: 'eye-1', qualityTier: 'standard', capabilities: new Set(['vision']) },
  {
    provider: 'mock',
    model: 'mock-1',
    qualityTier: 'standard',
    capabilities: ALL,
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  },
];

const adapters = new Map<string, ModelAdapter>(
  CATALOG.map((route) => [
    route.provider,
    {
      provider: route.provider,
      qualityTier: route.qualityTier,
      capabilities: route.capabilities,
      generate: async () => {
        throw new Error('routing evals never call providers');
      },
    },
  ]),
);

describe('model routing evals (dataset-driven, no provider calls)', () => {
  const router = new ModelRouter(adapters, CATALOG);

  it('has unique case ids', () => {
    const ids = ROUTING_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const evalCase of ROUTING_EVAL_CASES) {
    it(`${evalCase.id}: ${evalCase.description}`, () => {
      if (evalCase.expected === 'NO_ROUTE') {
        expect(() => router.selectRoute(evalCase.policy)).toThrow(ModelPolicyNoRouteError);
      } else {
        const route = router.selectRoute(evalCase.policy);
        expect({ provider: route.provider, model: route.model }).toEqual(evalCase.expected);
      }
    });
  }
});
