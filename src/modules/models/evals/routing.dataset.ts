import type { ModelPolicy } from '../domain/model-policy.js';

/**
 * Routing evaluation dataset: each case is a policy plus the route (or
 * refusal) the gateway must produce against the catalog in routing.eval.test.ts.
 * Add a case whenever a routing bug or a new guardrail is found.
 */
export interface RoutingEvalCase {
  readonly id: string;
  readonly description: string;
  readonly policy: ModelPolicy;
  readonly expected: { readonly provider: string; readonly model: string } | 'NO_ROUTE';
}

export const ROUTING_EVAL_CASES: readonly RoutingEvalCase[] = [
  { id: 'default-prefers-first-route', description: 'empty policy takes the first catalog route', policy: {}, expected: { provider: 'premium-co', model: 'big-1' } },
  { id: 'economy-allows-premium', description: 'a lower tier requirement accepts a higher tier route', policy: { qualityTier: 'economy' }, expected: { provider: 'premium-co', model: 'big-1' } },
  { id: 'vision-needs-capability', description: 'vision skips routes without the capability', policy: { requiredCapabilities: ['vision'] }, expected: { provider: 'vision-co', model: 'eye-1' } },
  { id: 'all-capabilities-required', description: 'every required capability must be present on one route', policy: { requiredCapabilities: ['vision', 'long_context'] }, expected: { provider: 'mock', model: 'mock-1' } },
  { id: 'allowlist-restricts', description: 'allowedProviders limits the catalog', policy: { allowedProviders: ['mock'] }, expected: { provider: 'mock', model: 'mock-1' } },
  { id: 'denylist-excludes', description: 'disallowedProviders removes a provider', policy: { disallowedProviders: ['premium-co', 'vision-co'] }, expected: { provider: 'mock', model: 'mock-1' } },
  { id: 'deny-beats-allow', description: 'a provider both allowed and disallowed is excluded', policy: { allowedProviders: ['premium-co'], disallowedProviders: ['premium-co'] }, expected: 'NO_ROUTE' },
  { id: 'empty-allowlist-means-none', description: 'an empty allowlist never matches anything', policy: { allowedProviders: [] }, expected: 'NO_ROUTE' },
  { id: 'unknown-provider', description: 'a provider that is not in the catalog has no route', policy: { allowedProviders: ['ghost'] }, expected: 'NO_ROUTE' },
  { id: 'budget-skips-expensive', description: 'a tiny budget skips paid routes and lands on the free mock', policy: { maxCostPerRunUsd: 0.000001 }, expected: { provider: 'mock', model: 'mock-1' } },
  { id: 'budget-excludes-unpriced', description: 'unpriced routes never satisfy a budget', policy: { allowedProviders: ['vision-co'], maxCostPerRunUsd: 100 }, expected: 'NO_ROUTE' },
  { id: 'negative-budget', description: 'a negative budget is invalid and matches nothing', policy: { maxCostPerRunUsd: -1 }, expected: 'NO_ROUTE' },
  { id: 'premium-needs-premium', description: 'a premium requirement excludes standard routes', policy: { qualityTier: 'premium', allowedProviders: ['mock'] }, expected: 'NO_ROUTE' },
];
