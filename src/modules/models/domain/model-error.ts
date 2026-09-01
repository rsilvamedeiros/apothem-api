/**
 * Provider errors are normalized into these classes — see
 * apothem-ai/docs/04-ai/model-gateway-routing.md ("Fallback"). Callers
 * (the future run worker) branch on `errorClass`, never on a provider SDK
 * exception type, so no provider SDK type leaks past infrastructure/ai.
 */
export const MODEL_ERROR_CLASSES = [
  'transient',
  'rate_limit',
  'auth',
  'invalid_request',
  'safety',
  'unavailable',
] as const;
export type ModelErrorClass = (typeof MODEL_ERROR_CLASSES)[number];

export class ModelProviderError extends Error {
  constructor(
    message: string,
    readonly errorClass: ModelErrorClass,
    readonly provider: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ModelProviderError';
  }
}

/** Maps to the runtime's stable MODEL_POLICY_NO_ROUTE code — see agent-runtime.md. */
export class ModelPolicyNoRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelPolicyNoRouteError';
  }
}
