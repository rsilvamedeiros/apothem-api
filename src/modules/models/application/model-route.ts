import type { ModelCapability, QualityTier } from '../domain/model-policy.js';

/** One entry in the router's static catalog — which (provider, model) pairs exist and what they support. */
export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
  readonly qualityTier: QualityTier;
  readonly capabilities: ReadonlySet<ModelCapability>;
}
