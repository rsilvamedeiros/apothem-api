# runs

**Status:** v1 implemented - synchronous single model call, durable record, no tools or approvals yet

Owns Run and RunStep: the immutable, auditable record of an agent execution attempt. Decision context: `apothem-ai/docs/04-ai/agent-runtime.md` and `03-domain/executions-audit.md`.

## What a run is

- `POST /v1/organizations/:org/workspaces/:ws/agents/:agentId/runs` starts a run of the agent's **active published version** (drafts, disabled and archived agents are refused with 409). The server assembles the model request from the immutable version: instructions as the system prompt, the task text as the only user message, the version's model policy and run limits. The client sends only `input` (1-20000 characters) and an optional `idempotencyKey`; tools, model, tenant ids and anything else are ignored.
- `GET .../runs` (newest first, keyset cursor, `agentId` filter) and `GET .../runs/:runId` (with steps) read them. Operators see only their own runs; another's run is a 404.
- State machine (`domain/run-state.ts`): `queued -> running -> completed | failed | cancelled`. A terminal run is never rewritten: transitions are compare-and-set on the stored state, so a late result (e.g. after a timeout) cannot overwrite the outcome.

## Rules enforced (and tested)

- Authorization: `agent.run` to start (owner, admin, builder, operator), `run.read` to read; workspace scope required; cross-workspace and cross-organization ids look like missing ones.
- Idempotency: the same key returns the existing run (200, `replayed: true`) without calling the model again, including when identical requests arrive simultaneously (unique index plus replay of the winner). A key reused for another agent or by another principal is a 409.
- Budgets: per-run `maxOutputTokens` (default 1024, ceiling 4096) and `timeoutMs` (default 30s, ceiling 60s) come from the version's `guardrails`; the cost budget comes from the model policy (`maxCostPerRunUsd`, enforced by the gateway, fail closed). Exceeding the time budget records `RUN_BUDGET_EXCEEDED`.
- Failures are recorded as `failed` runs with a stable public code (`RUN_CONFIG_INVALID`, `MODEL_POLICY_NO_ROUTE`, `MODEL_PROVIDER_UNAVAILABLE`, `MODEL_REQUEST_REJECTED`, `RUN_BUDGET_EXCEEDED`, `TOOL_NOT_BOUND`, `RUN_INTERNAL_ERROR`) and a fixed message. Provider error text, API keys, policy details and tool names are never stored. No automatic retry.
- A model tool request fails with `TOOL_NOT_BOUND`: no tool is bound or executed yet.
- Audit: `run.started` and `run.completed` / `run.failed` with ids, status and error code. The task text and the model output are never copied into the audit trail.
- Steps keep normalized metadata only (route, usage, finish reason, duration, error code), never hidden reasoning.

## Tests

State machine properties, service unit tests (failure mapping, secrets never stored, idempotency races, timeout, pinning, operator scoping, real mock router), HTTP route tests and real-Postgres integration tests (durable records, compare-and-set, concurrent idempotent requests, keyset paging, history after archive).

## Not built yet

Tools and approvals (`WAITING_APPROVAL`), knowledge retrieval, streaming, a worker queue (execution moves out of the request without changing the record), cost in currency (needs provider pricing), cancellation endpoint, retention jobs.

Reference docs (`apothem-ai/docs/`):
- `03-domain/executions-audit.md`
- `04-ai/agent-runtime.md`