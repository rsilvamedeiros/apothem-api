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
│   ├── fly/                     Fly.io deploy config (see ADR-009)
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
| Database | PostgreSQL + pgvector (ADR-003) — Docker Compose locally, Neon/Supabase free tier remotely |
| ORM / query layer | Drizzle |
| Authentication | Self-hosted OIDC (Auth.js/NextAuth or Lucia) — no managed auth vendor yet |
| Queue | Redis + BullMQ — Docker Compose locally, Upstash free tier remotely |
| Object storage | S3-compatible — MinIO locally, Cloudflare R2 free tier remotely |
| AI providers | OpenAI / Anthropic / Google, accessed only through the internal Model Gateway (ADR-004) — never a provider SDK directly in domain code |
| Backend hosting | Fly.io free allowance |
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

## Status

**Batch 1 (repository skeleton) in progress.** Node.js/TypeScript project, lint/typecheck/test tooling, env schema validation (`zod`), a minimal Fastify HTTP server with `GET /health`, and local Docker Compose (Postgres+pgvector, Redis, MinIO) are in place. Module folders otherwise hold only placeholder READMEs — see `apothem-ai/docs/17-roadmap/first-implementation-sequence.md` for the rest of the build sequence (Batches 1–3 and part of 5 are this repository's scope).

<a id="adr-008"></a>
### Why two repositories

The backend has materially different operational requirements than the frontend (long-running AI tasks, background workers, queues, ingestion, secrets, audit trails) and independent deploy cadence (Fly.io here vs. Vercel for the frontend) outweighs the contract-sharing convenience of a single repo. Full rationale: `apothem-ai/docs/adr/008-two-repository-split.md`.
