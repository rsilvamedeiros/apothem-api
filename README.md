# APOTHEM API

**Status:** Foundation / Scaffold
**Project:** APOTHEM AI
**Canonical domain:** `apothemai.com.br`
**Production URL:** `https://api.apothemai.com.br`
**Sibling repository (frontend):** [`apothem-ai`](https://github.com/apothem/apothem-ai)

> **Intelligence at the core.**

`apothem-api` is the backend of the APOTHEM AI platform: authentication and authorization, organizations/workspaces, the Agent Runtime, the multi-model AI Gateway, the Knowledge Engine (ingestion + retrieval), Connect (connections/tools), Flow (workflows), human approvals, execution history, usage and audit.

It is a standalone repository. The frontend (site + authenticated web app) lives in the separate [`apothem-ai`](https://github.com/apothem/apothem-ai) repository. See [ADR-008 — Split into Two Repositories](#adr-008) for why.

## Read this first

Canonical product/architecture documentation currently lives in the `apothem-ai` repository under `docs/` (no dedicated `apothem-docs` repo yet — see [ADR-008](#adr-008)). Before implementing anything here, read, in order:

1. `apothem-ai/README.md`
2. `apothem-ai/architecture.md`
3. `apothem-ai/docs/00-context/project-context.md`
4. `apothem-ai/docs/02-architecture/architecture-overview.md`
5. `apothem-ai/docs/03-domain/domain-model.md`
6. `apothem-ai/docs/04-ai/agent-runtime.md`
7. `apothem-ai/docs/08-security/security-model.md`
8. `apothem-ai/docs/09-data/database-design.md`
9. `apothem-ai/docs/17-roadmap/mvp.md`
10. `apothem-ai/docs/adr/` (all accepted ADRs, especially 002, 003, 004, 006, 007, 008, 009)
11. `CLAUDE.md` and `AGENTS.md` in this repository

`docs/` in this repository (see below) only holds backend-specific operational notes; it does not duplicate product/architecture documentation.

## What this service owns

- Authentication and session/principal abstraction
- Organizations, workspaces, memberships, RBAC/capability authorization
- Agents and AgentVersions (versioned, immutable once published)
- Agent Runtime: conversations, runs, run steps, tool proposals, policy evaluation
- Model Gateway: normalized multi-provider interface (OpenAI/Anthropic/Google), usage/cost normalization
- Knowledge Engine: sources, ingestion pipeline, chunking, embeddings, permission-aware retrieval with citations
- Connect: connections, credentials, typed tools, connector execution
- Approvals: policy-gated human-in-the-loop decisions
- Flow: durable workflows (triggers, nodes, conditions, retries) — introduced post-MVP
- Audit, usage/cost tracking, observability instrumentation
- Background workers for long-running/async work (ingestion, agent runs, connector sync)

What it explicitly does **not** own: presentation, navigation, optimistic UI, or any authorization/business-rule decision delegated to the frontend. See `apothem-ai/docs/02-architecture/architecture-overview.md`.

## Repository layout

```text
apothem-api/
├── src/
│   ├── modules/              bounded-context modules (see below)
│   ├── common/                cross-module utilities with no business rules
│   ├── infrastructure/        adapters implementing module ports
│   │   ├── database/          PostgreSQL/pgvector access, migrations runner
│   │   ├── queue/              Redis/BullMQ job producers/consumers
│   │   ├── storage/            S3-compatible object storage adapter
│   │   ├── ai/                  Model Gateway provider adapters
│   │   ├── secrets/             credential/secret encryption boundary
│   │   ├── telemetry/           logging, tracing, metrics
│   │   └── http/                 HTTP server/framework wiring
│   └── main/                   composition root / bootstrap
├── workers/
│   └── ai/                     long-running run/ingestion/workflow job consumers
├── database/                   seed/fixture data
├── migrations/                 SQL/schema migrations
├── docs/                        backend-specific operational notes only
├── infra/
│   ├── docker/                  local Docker Compose (Postgres+pgvector, Redis, MinIO)
│   ├── render/                  Render deploy config (see ADR-010)
│   └── scripts/                  operational scripts
├── CLAUDE.md
├── AGENTS.md
└── README.md
```

### Module list (`src/modules/`)

`identity`, `organizations`, `workspaces`, `authorization`, `agents`, `conversations`, `runs`, `models`, `knowledge`, `connections`, `tools`, `approvals`, `workflows`, `audit`, `usage`, `webhooks`.

Each module is expected to internally separate `domain/` (framework-independent entities/value-objects/events), `application/` (commands/queries/services), `infrastructure/` (repositories/adapters) and `presentation/http/` as it grows — see `apothem-ai/docs/02-architecture/architecture-overview.md` §"Arquitetura interna de módulo". Do not pre-create these subfolders before a module has real content — folders exist to hold decisions, not to satisfy a template.

Modules communicate through explicit interfaces/ports. A module must never write directly to another module's tables (e.g. `agents` must not mutate `knowledge` tables) — see `apothem-ai/architecture.md` §47, "Regras de dependência".

## Stack (decided)

Per `apothem-ai/docs/adr/009-zero-cost-initial-stack.md` — a **zero fixed-cost stack** for the pre-revenue phase, self-hosted/local-first with free tiers for anything that needs to run remotely. The one unavoidable cost is real LLM usage (billed per token, not a license).

| Layer | Choice |
|---|---|
| Language/runtime | Node.js + TypeScript |
| Architecture style | Modular monolith (ADR-002) |
| Database | PostgreSQL + pgvector (ADR-003) — Docker Compose locally, Supabase remotely (ADR-010) |
| ORM / query layer | Drizzle |
| Authentication | Self-hosted OIDC (Auth.js/NextAuth or Lucia) — no managed auth vendor yet |
| Queue | Redis + BullMQ — Docker Compose locally, Upstash free tier remotely |
| Object storage | S3-compatible — MinIO locally, Cloudflare R2 free tier remotely |
| AI providers | OpenAI / Anthropic / Google, accessed only through the internal Model Gateway (ADR-004) — never a provider SDK directly in domain code |
| Backend hosting | Render (ADR-010) |
| Frontend hosting (sibling repo) | Vercel free tier |
| Observability | Structured logs + OpenTelemetry instrumentation; no paid vendor yet |
| API contracts | OpenAPI spec published from this repo; `apothem-ai/packages/api-client` is generated from it — no hand-duplicated types |

This stack is provisional to the pre-revenue phase (see ADR-009's own "Alternatives" section) and is expected to be revisited once the company starts commercializing.

## Non-negotiable rules

These are enforced project-wide (mirrored from `apothem-ai/CLAUDE.md`) and apply to every module in this repository:

- Every tenant-owned resource carries `organization_id` and, where applicable, `workspace_id`. Tenant context is never optional.
- Never trust a tenant/workspace identifier received only from a client payload — authorization derives accessible scope from authenticated identity and server-side membership.
- Domain code never depends directly on an AI provider SDK (OpenAI/Anthropic/Google/etc.) — always through the Model Gateway abstraction.
- Agent executions are durable business records: run inputs, effective agent version, model decision metadata, tool calls, approvals, failures and final outcome must be preserved per retention policy.
- Side-effecting tools require explicit policy evaluation; high-risk actions must support human approval.
- A tool is an application capability with a typed input/output contract — not arbitrary model-generated code.
- Prompt text is versioned configuration, not scattered through ad hoc service functions.
- Knowledge retrieval preserves source identity and permissions so answers/actions trace back to authorized evidence.
- Audit logging is never bypassed to simplify a path involving permissions, tools, approvals or sensitive data.
- No microservice extraction without a concrete operational reason (scaling, reliability, security boundary, independent ownership) — see ADR-002.

## Local development

```bash
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres+pgvector, Redis, MinIO
npm install
npm run dev                                                # http://localhost:3001/health
```

Other useful scripts: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test`.

APIs external to this stack (LLM providers) continue to be called remotely; nothing about model access is mocked at the infrastructure level, only at the adapter level for tests/CI.

## Testing

```bash
npm test                 # unit + integration suites (no Docker needed)
npm run test:coverage    # same, with enforced coverage floors
npm run test:mutation    # Stryker on security-critical modules (cold run about 40 min; one file: npx stryker run --mutate <file>)
```

- **Unit and route tests** use in-memory fakes (`src/infrastructure/http/__fixtures__`).
- **Integration tests** (`*.integration.test.ts`) run the real Drizzle repositories and the full HTTP stack on PGlite (real Postgres compiled to WASM) with the committed `migrations/` applied. They need no Docker, network or cost, so they run identically locally and in CI. The CI `migration` job still validates the migrations on a real `pgvector/pgvector:pg16` service.
- **Evals** for the Model Gateway live in `src/modules/models/evals`; only the mock adapter runs in tests.
- Coverage floors only go up; security-critical modules have higher floors (see `vitest.config.ts`).
## Status

**Batches 1–5 complete** (repository skeleton, persistence, identity/authorization, delivery surfaces, CI/operations). Agent draft/version lifecycle and the Model Gateway (Milestone B of the MVP build order) are in progress; durable runs/worker are not started yet.

- Batch 1: Node.js/TypeScript project, lint/typecheck/test tooling, env schema validation (`zod`), a minimal Fastify HTTP server with `GET /health`, and local Docker Compose (Postgres+pgvector, Redis, MinIO).
- Batch 2: Drizzle ORM wired to PostgreSQL; schema and tenant-scoped repositories for principals, organizations, memberships, workspaces and workspace memberships; initial migration; idempotent demo seed (`npm run db:seed`).
- Batch 3: `AuthenticationPort` boundary with a bootstrap dev-only header adapter (`DevHeaderAuthenticator` — not for production, no cryptographic verification, to be replaced by self-hosted OIDC per ADR-009); `TenantContextResolver` that derives organization/workspace scope only from server-side membership state, never from a client-supplied id alone; capability-based `AuthorizationService` implementing the role/capability matrix from `apothem-ai/docs/01-product/permissions-matrix.md`; cross-tenant/IDOR regression tests.
- Batch 4: `GET /ready` (pings the database, `GET /health` stays a pure liveness check); `POST /v1/organizations`, `GET /v1/organizations/:organizationId`, `POST /v1/organizations/:organizationId/workspaces`, `GET /v1/organizations/:organizationId/workspaces`, `GET /v1/organizations/:organizationId/workspaces/:workspaceId` — all going through TenantContextResolver + AuthorizationService; normalized error shape with request-id correlation (`src/infrastructure/http/error-handler.ts`); an `AuditPort` backed by an append-only `audit_events` table, emitting `organization.created`, `membership.created` and `workspace.created`; an OpenAPI 3.0 spec generated from the same zod schemas that validate requests, served live at `GET /v1/openapi.json` and committed at `openapi/openapi.json` (`npm run openapi:generate`) for `apothem-ai/packages/api-client`.

- Batch 5: GitHub Actions CI (`.github/workflows/ci.yml`) — lint/typecheck/unit tests/build in one job; a second job that boots a clean Postgres+pgvector service container, fails if committed `migrations/` drift from the schema, then runs `db:migrate` and `db:seed` against it end-to-end; a third job running `npm audit --audit-level=high` as a dependency scan baseline. Correlation id (`request.id`) is echoed as `x-request-id` on every response and included in every normalized error body; sensitive headers (`authorization`, `x-principal-id`) are redacted from request logs. `npm run docs:check-links` validates every `apothem-ai/...` reference in this repo's markdown against a sibling checkout (no-ops if the sibling isn't present, e.g. in CI).
- Agents module (`src/modules/agents/`): Agent/AgentDraft/AgentVersion per `agents.md` and `agent-lifecycle.md` — draft create/edit, publish (creates an immutable, checksummed `agent_versions` snapshot and activates the agent on first publish), disable/archive, version history. `modelPolicy`/`knowledge`/`tool` bindings are opaque JSONB until the Model Gateway and knowledge/connect modules exist to give them a typed contract. New `agent.read` capability added to the Batch 3 role matrix. Not wired to the Model Gateway/a runtime yet — publishing only records a version, it does not execute anything.
- Model Gateway (`src/modules/models/` port + router, `src/infrastructure/ai/` adapters): `ModelGatewayPort`/`ModelAdapter` normalize `generate()` across providers; `ModelRouter` matches an agent's `ModelPolicy` (required capabilities, quality tier, allow/deny-listed providers) against a static route catalog and dispatches to the matching adapter, normalizing provider errors into `transient`/`rate_limit`/`auth`/`invalid_request`/`safety`/`unavailable` classes (`model-gateway-routing.md`). `MockModelAdapter` is deterministic and always registered — the only adapter exercised in tests/CI. `AnthropicModelAdapter` wraps `@anthropic-ai/sdk` and is only registered when `ANTHROPIC_API_KEY` is set (never in CI); it is the only file allowed to import the SDK, enforced by an ESLint override. Not wired to any HTTP route or to the agents module yet — that starts with the `runs` module.

See `apothem-ai/docs/17-roadmap/first-implementation-sequence.md` for the rest of the build sequence (Batches 1–3 and part of 5 are this repository's scope; Batch 4's API is this repository's scope, its web-shell/api-client half is `apothem-ai`'s).

<a id="adr-008"></a>
### Why two repositories

The backend has materially different operational requirements than the frontend (long-running AI tasks, background workers, queues, ingestion, secrets, audit trails) and independent deploy cadence (Render here vs. Vercel for the frontend) outweighs the contract-sharing convenience of a single repo. Full rationale: `apothem-ai/docs/adr/008-two-repository-split.md`.
