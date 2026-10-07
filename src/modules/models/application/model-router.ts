import type { ModelPolicy, QualityTier } from '../domain/model-policy.js';
import { ModelPolicyNoRouteError, ModelProviderError } from '../domain/model-error.js';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  type GenerateRequest,
  type GenerateResult,
  type ModelAdapter,
  type ModelGatewayPort,
} from './model-gateway.port.js';
import type { ModelRoute } from './model-route.js';

const QUALITY_RANK: Record<QualityTier, number> = { economy: 0, standard: 1, premium: 2 };

const TOKENS_PER_MILLION = 1_000_000;

/** Rough, deliberately conservative estimate (about 4 characters per token, rounded up). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Upper bound for one call: every input character billed plus the full output cap. */
function worstCaseCostUsd(route: ModelRoute, request: GenerateRequest): number | undefined {
  if (!route.pricing) {
    return undefined;
  }
  const inputTokens =
    estimateTokens(request.systemInstructions) +
    request.messages.reduce((total, message) => total + estimateTokens(message.content), 0);
  const outputTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  return (
    (inputTokens * route.pricing.inputUsdPerMillionTokens + outputTokens * route.pricing.outputUsdPerMillionTokens) /
    TOKENS_PER_MILLION
  );
}

function withinBudget(route: ModelRoute, policy: ModelPolicy, request: GenerateRequest): boolean {
  if (policy.maxCostPerRunUsd === undefined) {
    return true;
  }
  if (!Number.isFinite(policy.maxCostPerRunUsd) || policy.maxCostPerRunUsd < 0) {
    return false;
  }
  const cost = worstCaseCostUsd(route, request);
  // A route that cannot be priced cannot be proven to fit the budget: fail closed.
  return cost !== undefined && cost <= policy.maxCostPerRunUsd;
}

const EMPTY_REQUEST: GenerateRequest = { systemInstructions: '', messages: [] };

/**
 * Evaluates ModelPolicy against a static route catalog (see
 * model-gateway-routing.md "Routing") and dispatches to the matching
 * adapter. Does not consider live provider availability/rate limits yet —
 * that is future routing work, tracked separately from this contract.
 */
export class ModelRouter implements ModelGatewayPort {
  constructor(
    private readonly adapters: ReadonlyMap<string, ModelAdapter>,
    // Preference order: first matching route wins.
    private readonly routes: readonly ModelRoute[],
  ) {}

  selectRoute(policy: ModelPolicy, request: GenerateRequest = EMPTY_REQUEST): ModelRoute {
    const candidate = this.routes.find((route) => {
      if (policy.allowedProviders && !policy.allowedProviders.includes(route.provider)) {
        return false;
      }
      if (policy.disallowedProviders?.includes(route.provider)) {
        return false;
      }
      if (policy.requiredCapabilities?.some((capability) => !route.capabilities.has(capability))) {
        return false;
      }
      if (policy.qualityTier && QUALITY_RANK[route.qualityTier] < QUALITY_RANK[policy.qualityTier]) {
        return false;
      }
      return withinBudget(route, policy, request);
    });

    if (!candidate) {
      throw new ModelPolicyNoRouteError(
        `No model route satisfies policy: ${JSON.stringify(policy)}`,
      );
    }
    return candidate;
  }

  async generate(policy: ModelPolicy, request: GenerateRequest): Promise<GenerateResult> {
    const route = this.selectRoute(policy, request);
    const adapter = this.adapters.get(route.provider);
    if (!adapter) {
      // Registry inconsistency: a route exists for a provider with no
      // registered adapter (e.g. its API key isn't configured). Treat it the
      // same as "no route" rather than crashing with an unclear TypeError.
      throw new ModelPolicyNoRouteError(`Provider "${route.provider}" has a route but no registered adapter`);
    }

    try {
      return await adapter.generate(route.model, request);
    } catch (error) {
      if (error instanceof ModelProviderError) {
        throw error;
      }
      // An adapter is expected to classify its own errors; an unclassified
      // throw is treated as transient so callers can still apply retry
      // policy rather than failing the run outright on an adapter bug.
      throw new ModelProviderError(
        error instanceof Error ? error.message : 'Unknown model provider error',
        'transient',
        route.provider,
        { cause: error },
      );
    }
  }
}
