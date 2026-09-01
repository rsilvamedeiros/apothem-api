# agents

**Status:** Draft/publish lifecycle implemented — no Model Gateway/runtime yet.

Owns Agent, AgentDraft and AgentVersion. `Agent` is mutable identity (name, slug, description, status, active version pointer). `AgentDraft` is the one mutable editable-config row per agent. `AgentVersion` is an immutable publication snapshot (instructions, model policy, knowledge/tool bindings, memory policy, guardrails, checksum) — this is what makes a run reproducible; there is deliberately no update/delete repository method for it.

`modelPolicy`/`knowledgeBindings`/`toolBindings` are opaque JSONB for now — they get a typed contract once the Model Gateway (ADR-004) and knowledge/connect modules exist. HTTP surface: `src/modules/agents/presentation/http/agents.routes.ts`, nested under `/v1/organizations/:organizationId/workspaces/:workspaceId/agents`. Not built yet: durable runs (`src/modules/runs`), the Model Gateway itself, and anything that actually executes a published version.

Reference docs (`apothem-ai/docs/`):
- `03-domain/agents.md`
- `04-ai/agent-lifecycle.md`
- `04-ai/agent-runtime.md`
