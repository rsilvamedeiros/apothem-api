import { describe, expect, it } from 'vitest';
import { ModelRouter } from './model-router.js';
import { ModelPolicyNoRouteError, ModelProviderError } from '../domain/model-error.js';
import type { ModelAdapter, GenerateRequest, GenerateResult } from './model-gateway.port.js';
import type { ModelRoute } from './model-route.js';
import type { ModelPolicy } from '../domain/model-policy.js';

class StubAdapter implements ModelAdapter {
  constructor(
    readonly provider: string,
    readonly qualityTier: ModelAdapter['qualityTier'],
    readonly capabilities: ModelAdapter['capabilities'],
    private readonly behavior: 'succeed' | 'throw-classified' | 'throw-raw' = 'succeed',
  ) {}

  async generate(model: string): Promise<GenerateResult> {
    if (this.behavior === 'throw-classified') {
      throw new ModelProviderError('rate limited', 'rate_limit', this.provider);
    }
    if (this.behavior === 'throw-raw') {
      throw new Error('boom');
    }
    return {
      provider: this.provider,
      model,
      output: { type: 'text', text: 'ok' },
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: 'stop',
    };
  }
}

const REQUEST: GenerateRequest = { systemInstructions: 'sys', messages: [{ role: 'user', content: 'hi' }] };

function buildRouter(adapters: ModelAdapter[], routes: ModelRoute[]): ModelRouter {
  return new ModelRouter(new Map(adapters.map((a) => [a.provider, a])), routes);
}

describe('ModelRouter', () => {
  it('selects the first route matching required capabilities and quality tier', async () => {
    const economyAdapter = new StubAdapter('economy-provider', 'economy', new Set(['tool_calling']));
    const premiumAdapter = new StubAdapter('premium-provider', 'premium', new Set(['tool_calling', 'vision']));

    const router = buildRouter(
      [economyAdapter, premiumAdapter],
      [
        { provider: 'economy-provider', model: 'e-1', qualityTier: 'economy', capabilities: economyAdapter.capabilities },
        { provider: 'premium-provider', model: 'p-1', qualityTier: 'premium', capabilities: premiumAdapter.capabilities },
      ],
    );

    const policy: ModelPolicy = { requiredCapabilities: ['vision'] };
    const result = await router.generate(policy, REQUEST);
    expect(result.provider).toBe('premium-provider');
  });

  it('respects allowedProviders and disallowedProviders', () => {
    const a = new StubAdapter('a', 'standard', new Set());
    const b = new StubAdapter('b', 'standard', new Set());
    const router = buildRouter(
      [a, b],
      [
        { provider: 'a', model: 'a-1', qualityTier: 'standard', capabilities: a.capabilities },
        { provider: 'b', model: 'b-1', qualityTier: 'standard', capabilities: b.capabilities },
      ],
    );

    expect(router.selectRoute({ allowedProviders: ['b'] }).provider).toBe('b');
    expect(() => router.selectRoute({ disallowedProviders: ['a', 'b'] })).toThrow(ModelPolicyNoRouteError);
  });

  it('throws ModelPolicyNoRouteError when no route satisfies the policy', () => {
    const a = new StubAdapter('a', 'economy', new Set());
    const router = buildRouter(
      [a],
      [{ provider: 'a', model: 'a-1', qualityTier: 'economy', capabilities: a.capabilities }],
    );
    expect(() => router.selectRoute({ qualityTier: 'premium' })).toThrow(ModelPolicyNoRouteError);
  });

  it('propagates a classified ModelProviderError from the adapter unchanged', async () => {
    const a = new StubAdapter('a', 'standard', new Set(), 'throw-classified');
    const router = buildRouter([a], [{ provider: 'a', model: 'a-1', qualityTier: 'standard', capabilities: a.capabilities }]);

    await expect(router.generate({}, REQUEST)).rejects.toMatchObject({
      errorClass: 'rate_limit',
      provider: 'a',
    });
  });

  it('wraps an unclassified adapter error as a transient ModelProviderError', async () => {
    const a = new StubAdapter('a', 'standard', new Set(), 'throw-raw');
    const router = buildRouter([a], [{ provider: 'a', model: 'a-1', qualityTier: 'standard', capabilities: a.capabilities }]);

    await expect(router.generate({}, REQUEST)).rejects.toMatchObject({
      errorClass: 'transient',
      provider: 'a',
    });
  });

  it('throws ModelPolicyNoRouteError when a route exists but its adapter is not registered', async () => {
    const router = new ModelRouter(
      new Map(),
      [{ provider: 'ghost', model: 'g-1', qualityTier: 'standard', capabilities: new Set() }],
    );
    await expect(router.generate({}, REQUEST)).rejects.toThrow(ModelPolicyNoRouteError);
  });
});
