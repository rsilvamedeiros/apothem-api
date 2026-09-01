# models

**Status:** `generate()` implemented; `stream()`/`embed()`/`generateStructured()` not built yet.

Owns the Model Gateway contract and routing policy: `ModelGatewayPort`/`ModelAdapter` (`application/model-gateway.port.ts`), the capability/quality-tier route matcher (`application/model-router.ts`), and the policy vocabulary + normalized error classes (`domain/`). Provider-specific SDKs (OpenAI/Anthropic/Google) are never imported here — only in `src/infrastructure/ai`, which implements `ModelAdapter` against this module's port. `ModelRouter` is not wired to any HTTP route yet; it becomes load-bearing once the `runs` module exists to call it from a durable run.

Reference docs (`apothem-ai/docs/`):
- `04-ai/model-gateway-routing.md`
- `04-ai/ai-architecture.md`
- `adr/004-multi-model.md`
