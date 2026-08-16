# models

**Status:** Placeholder — no code yet

Owns the Model Gateway / Model Router abstraction: `generate()`, `stream()`, `embed()`, `generateStructured()`. Provider-specific SDKs (OpenAI/Anthropic/Google) are encapsulated in adapters here and must never leak into domain code elsewhere.

Reference docs (`apothem-ai/docs/`):
- `04-ai/model-gateway-routing.md`
- `04-ai/ai-architecture.md`
- `adr/004-multi-model.md`
