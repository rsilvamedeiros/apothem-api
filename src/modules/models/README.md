# models

**Status:** `generate()` implemented; `stream()`/`embed()`/`generateStructured()` not built yet.

Owns the Model Gateway contract and routing policy: `ModelGatewayPort`/`ModelAdapter` (`application/model-gateway.port.ts`), the capability/quality-tier route matcher (`application/model-router.ts`), and the policy vocabulary + normalized error classes (`domain/`). Provider-specific SDKs (OpenAI/Anthropic/Google) are never imported here — only in `src/infrastructure/ai`, which implements `ModelAdapter` against this module's port. `ModelRouter` is not wired to any HTTP route yet; it becomes load-bearing once the `runs` module exists to call it from a durable run.

Reference docs (`apothem-ai/docs/`):
- `04-ai/model-gateway-routing.md`
- `04-ai/ai-architecture.md`
- `adr/004-multi-model.md`

## Guardrails enforced by the router

- `allowedProviders` / `disallowedProviders` (deny wins; an empty allowlist matches nothing), `requiredCapabilities` (all must be present) and `qualityTier` (a route must be at least that tier).
- `maxCostPerRunUsd`: the worst-case cost of one call (conservative input estimate plus the full output cap, default 1024 tokens) must fit the budget. A route with no `pricing` never satisfies a budget (fail closed), and an invalid budget (negative or non-finite) matches nothing. The mock route is priced at zero; provider prices are intentionally not hard-coded yet.
- `fallbackAllowed` is declared in the policy vocabulary but the router performs no fallback at all today, which is equivalent to `false`. Fallback is designed together with runs (duplicate side-effect risk).

## Tests

Router and budget unit tests, the Anthropic adapter exercised through an injected fake client (no network, no cost), and a dataset-driven routing eval (`evals/routing.dataset.ts`). Add a case to the dataset whenever a routing bug or guardrail is found.
