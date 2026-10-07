# agents

**Status:** Draft/publish lifecycle implemented — no Model Gateway/runtime yet.

Owns Agent, AgentDraft and AgentVersion. `Agent` is mutable identity (name, slug, description, status, active version pointer). `AgentDraft` is the one mutable editable-config row per agent. `AgentVersion` is an immutable publication snapshot (instructions, model policy, knowledge/tool bindings, memory policy, guardrails, checksum) — this is what makes a run reproducible; there is deliberately no update/delete repository method for it.

`modelPolicy`/`knowledgeBindings`/`toolBindings` are opaque JSONB for now — they get a typed contract once the Model Gateway (ADR-004) and knowledge/connect modules exist. HTTP surface: `src/modules/agents/presentation/http/agents.routes.ts`, nested under `/v1/organizations/:organizationId/workspaces/:workspaceId/agents`. Not built yet: durable runs (`src/modules/runs`), the Model Gateway itself, and anything that actually executes a published version.

Reference docs (`apothem-ai/docs/`):
- `03-domain/agents.md`
- `04-ai/agent-lifecycle.md`
- `04-ai/agent-runtime.md`

## Rules enforced (and tested)

- Agents are workspace-owned: every operation requires a resolved workspace scope and looks agents up by `(workspaceId, agentId)`, so another workspace's agent is indistinguishable from a missing one (404).
- `agent.draft.write` edits drafts; `agent.publish` publishes, disables and archives. Builders can draft but not publish.
- Publishing snapshots the draft into an immutable version with a SHA-256 checksum over a canonical (key-order independent) JSON of the snapshot. Identical snapshots hash identically; any change produces a new hash.
- `archived` is terminal: no draft edits, no publish, no status change.
- Every state-changing operation emits an audit event; denied operations emit nothing and change nothing.
- The version port has no update/delete operation, enforced by a test.

## Tests

Service unit tests (`agent.service.test.ts`, `canonical-json.test.ts`), HTTP route and validation tests, mutation testing via `npm run test:mutation` (score about 91% for authorization + agents application).
