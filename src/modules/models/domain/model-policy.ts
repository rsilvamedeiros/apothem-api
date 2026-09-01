/**
 * Expresses agent-version preferences/requirements against the Model
 * Gateway rather than hard-wiring a vendor name — see
 * apothem-ai/docs/04-ai/model-gateway-routing.md ("Model policy") and
 * ADR-004. Lives alongside the AgentVersion's modelPolicy JSONB snapshot
 * once the agents module starts building real ExecutionContext (runs).
 */
export const MODEL_CAPABILITIES = ['tool_calling', 'structured_output', 'vision', 'long_context'] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const QUALITY_TIERS = ['economy', 'standard', 'premium'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export interface ModelPolicy {
  readonly requiredCapabilities?: readonly ModelCapability[];
  readonly qualityTier?: QualityTier;
  readonly allowedProviders?: readonly string[];
  readonly disallowedProviders?: readonly string[];
  readonly maxCostPerRunUsd?: number;
  readonly fallbackAllowed?: boolean;
}
