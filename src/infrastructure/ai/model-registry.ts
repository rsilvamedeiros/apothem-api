import { MockModelAdapter } from './mock-model.adapter.js';
import { AnthropicModelAdapter } from './anthropic-model.adapter.js';
import { ModelRouter } from '../../modules/models/application/model-router.js';
import type { ModelAdapter } from '../../modules/models/application/model-gateway.port.js';
import type { ModelRoute } from '../../modules/models/application/model-route.js';
import type { Env } from '../http/env.js';

/**
 * Composition root for the Model Gateway: registers one adapter per
 * configured provider and the static route catalog the router matches
 * policies against. `env.ANTHROPIC_API_KEY` unset (the CI/test default —
 * see apothem-ai/CLAUDE.md) means only the mock adapter/route exists, so
 * every policy resolves to it deterministically.
 */
export function buildModelRouter(env: Env): ModelRouter {
  const adapters = new Map<string, ModelAdapter>();
  const routes: ModelRoute[] = [];

  if (env.ANTHROPIC_API_KEY) {
    const anthropic = new AnthropicModelAdapter(env.ANTHROPIC_API_KEY);
    adapters.set(anthropic.provider, anthropic);
    // Preference order within the provider: higher-quality route first.
    // Anthropic routes carry no `pricing` on purpose: prices are not hard-coded
    // here, so policies with maxCostPerRunUsd fail closed instead of guessing.
    routes.push(
      {
        provider: anthropic.provider,
        model: 'claude-sonnet-4-5',
        qualityTier: anthropic.qualityTier,
        capabilities: anthropic.capabilities,
      },
      {
        provider: anthropic.provider,
        model: 'claude-haiku-4-5',
        qualityTier: 'standard',
        capabilities: anthropic.capabilities,
      },
    );
  }

  // Registered last so a real provider is preferred whenever one is
  // configured; still always present so a policy that explicitly requests
  // provider "mock" (tests, CI, local dev without an API key) always has a
  // route.
  const mock = new MockModelAdapter();
  adapters.set(mock.provider, mock);
  routes.push({
    provider: mock.provider,
    model: 'mock-1',
    qualityTier: mock.qualityTier,
    capabilities: mock.capabilities,
    // No network, no cost: always satisfies a budget.
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  });

  return new ModelRouter(adapters, routes);
}
