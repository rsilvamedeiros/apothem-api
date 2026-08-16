# Claude Code Project Instructions

**Status:** Foundation / Scaffold
**Project:** APOTHEM AI — `apothem-api` (backend)
**Canonical domain:** `apothemai.com.br`

This file defines how Claude Code should work inside the `apothem-api` repository. It is an engineering contract, not a suggestion list. It mirrors and specializes `apothem-ai/CLAUDE.md` for the backend.

## Mandatory context before implementation

Canonical product/architecture documentation lives in the sibling `apothem-ai` repository (see `README.md` here for the reading order and file paths — no dedicated `apothem-docs` repo yet, per ADR-008). Before creating or materially changing code, read:

1. `apothem-ai/README.md` and `apothem-ai/architecture.md`
2. `apothem-ai/docs/00-context/project-context.md`
3. `apothem-ai/docs/02-architecture/architecture-overview.md`
4. the domain document for the module being changed (`apothem-ai/docs/03-domain/*`)
5. the relevant AI/knowledge/connect/flow/security/data/API document for the area being changed
6. active ADRs under `apothem-ai/docs/adr/`, especially 002 (modular monolith), 003 (Postgres+pgvector), 004 (multi-model), 006 (multi-tenant), 007 (human approval default), 008 (two-repository split), 009 (zero-cost stack)

If the requested implementation conflicts with documentation, **do not silently choose one**. Prefer the documented decision and surface the conflict. If the change is intentional, update or add an ADR in `apothem-ai/docs/adr/` together with the code — this repository does not maintain its own separate ADR series.

## Non-negotiable project rules

- APOTHEM is multi-tenant from the domain model forward. Tenant context (`organization_id`, and `workspace_id` where applicable) is never optional on tenant-owned resources.
- Never trust a tenant/workspace identifier received only from a client payload. Authorization must derive accessible scope from authenticated identity and server-side membership.
- AI providers are infrastructure dependencies. Domain code must not depend directly on OpenAI, Anthropic, Google or another provider SDK — only through `src/infrastructure/ai` (the Model Gateway).
- Agent executions are durable business records. Preserve run inputs, effective agent version, model decision metadata, tool calls, approvals, failures and final outcome according to retention policy.
- Side-effecting tools require explicit policy evaluation. High-risk actions must support human approval.
- A tool is an application capability with a typed contract, not arbitrary model-generated code.
- Prompt text is versioned configuration. Do not scatter critical prompts through ad hoc service functions.
- Knowledge retrieval must preserve source identity and permissions so answers/actions can be traced back to authorized evidence.
- Never bypass audit logging to "simplify" an implementation path involving permissions, tools, approvals or sensitive data.
- Do not add microservices merely for conceptual purity. Extraction needs an operational reason: scaling, reliability, security boundary, language/runtime requirement or independent ownership.
- The frontend (`apothem-ai` repository) must never be given security or business-rule authority — this repository is the source of truth for authorization, validation and business rules; the frontend only presents and calls the generated API client.

## Stack baseline (do not silently change)

Per ADR-009 (`apothem-ai/docs/adr/009-zero-cost-initial-stack.md`): Node.js + TypeScript, PostgreSQL + pgvector, Drizzle ORM, self-hosted OIDC auth, Redis + BullMQ, S3-compatible storage (MinIO/R2), Fly.io hosting. This is a pre-revenue, cost-constrained baseline — treat it as current architecture law, not a suggestion, until a new ADR supersedes it.

## Coding direction for the scaffold

```text
src/modules/        identity, organizations, workspaces, authorization, agents,
                     conversations, runs, models, knowledge, connections, tools,
                     approvals, workflows, audit, usage, webhooks
src/common/
src/infrastructure/ database, queue, storage, ai, secrets, telemetry, http
src/main/
workers/ai/
database/
migrations/
infra/
```

Do not create module-internal `domain/application/infrastructure/presentation` subfolders before a module has real content to put in them — see `apothem-ai/docs/02-architecture/architecture-overview.md`. This is a direction, not a scaffolding obligation.

## How to implement a feature

For every non-trivial feature:

1. Identify bounded context and owning module (from the list above).
2. Define or update domain contracts.
3. Define authorization and tenant scope.
4. Define persistence changes and migration.
5. Define synchronous API behavior and asynchronous events/jobs.
6. Define audit/observability requirements.
7. Define tests, including denied paths and tenant-isolation tests.
8. Update the OpenAPI spec so `apothem-ai/packages/api-client` can regenerate — do not hand-maintain duplicate types in the frontend.
9. Update documentation (in `apothem-ai/docs/`) when behavior changes.

## AI-specific development rule

Do not test AI features only by "trying the chat". AI behavior requires deterministic contract tests plus evaluation datasets for semantic behavior. New agents/tools should declare expected scenarios, failure behavior and guardrails. Use the mock Model Gateway adapter in tests/CI; only exercise a real provider adapter deliberately (and be aware this incurs real token cost).

## Definition of done

A feature is not done because the happy path works. At minimum it must have: authorization, validation, error model, auditability, telemetry, tests, migration safety where applicable, and documentation alignment (in `apothem-ai/docs/`).
