# infrastructure/ai

**Status:** Mock + Anthropic adapters implemented.

The Model Gateway's provider adapters. This is the *only* place in the codebase allowed to import a provider SDK — enforced by an ESLint `no-restricted-imports` override scoped to this directory (`.eslintrc.json`). Everything else calls the normalized `ModelGatewayPort`/`ModelAdapter` interface from `../../modules/models`.

- `mock-model.adapter.ts` — deterministic, no network call, always registered. This is what tests/CI exercise (see `apothem-ai/CLAUDE.md`).
- `anthropic-model.adapter.ts` — wraps `@anthropic-ai/sdk`, classifies SDK errors into the gateway's `auth`/`rate_limit`/`invalid_request`/`unavailable`/`transient` classes. Only registered when `ANTHROPIC_API_KEY` is set; exercising it against the real API incurs token cost.
- `model-registry.ts` — composition root: builds the adapter map + route catalog and returns a `ModelRouter` (`../../modules/models/application/model-router.ts`).

No OpenAI/Google adapter yet — ADR-004/ADR-009 keep multiple production providers behind proving the gateway contract with one real adapter + mock first (`apothem-ai/docs/17-roadmap/mvp.md`, "Things Claude Code must not build in the first scaffold").

Reference docs (`apothem-ai/docs/`):
- `04-ai/model-gateway-routing.md`
- `adr/004-multi-model.md`
