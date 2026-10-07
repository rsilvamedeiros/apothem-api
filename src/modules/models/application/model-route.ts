import type { ModelCapability, QualityTier } from '../domain/model-policy.js';

/** One entry in the router's static catalog — which (provider, model) pairs exist and what they support. */
export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
  readonly qualityTier: QualityTier;
  readonly capabilities: ReadonlySet<ModelCapability>;
  /** Needed to honor `maxCostPerRunUsd`; a route without pricing is never chosen under a budget. */
  readonly pricing?: ModelPricing;
}

export interface ModelPricing {
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
}
