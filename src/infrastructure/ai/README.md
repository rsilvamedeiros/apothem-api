# infrastructure/ai

**Status:** Placeholder — no code yet

The Model Gateway's provider adapters (OpenAI/Anthropic/Google). This is the *only* place in the codebase allowed to import a provider SDK. Everything else calls the normalized interface exposed to `../../modules/models`.

Reference docs (`apothem-ai/docs/`):
- `04-ai/model-gateway-routing.md`
- `adr/004-multi-model.md`
