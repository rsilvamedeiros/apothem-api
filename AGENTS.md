# Coding Agent Operating Rules

**Status:** Foundation / Scaffold
**Project:** APOTHEM AI — `apothem-api` (backend)
**Canonical domain:** `apothemai.com.br`

This repository is expected to be used with coding agents. This document prevents an agent from optimizing locally while weakening product architecture globally. It mirrors `apothem-ai/AGENTS.md` for the backend.

## What agents may decide autonomously

Coding agents may choose local implementation details when they do not alter a documented architectural boundary: helper function names, private module organization, test fixtures, internal refactors, and non-public types.

## What requires explicit documentation or ADR impact

Do not silently change:

- tenant model or ownership hierarchy;
- public API semantics;
- authentication strategy;
- authorization rules;
- agent run state machine;
- approval semantics;
- model-provider abstraction;
- knowledge permission model;
- storage strategy;
- event delivery guarantees;
- deployment boundaries;
- data retention categories;
- audit event contract;
- the repository split or stack baseline decided in ADR-008/ADR-009.

ADRs for this repository live in `apothem-ai/docs/adr/` — there is no separate ADR series here.

## Default behavior when a specification is incomplete

1. Prefer least privilege.
2. Prefer reversibility.
3. Prefer explicit state over inferred state.
4. Prefer typed contracts over unstructured payloads.
5. Prefer asynchronous processing for long-running AI/document work.
6. Prefer idempotent application commands.
7. Prefer auditability over hidden convenience.
8. Prefer a modular monolith over premature service extraction.
9. Prefer the zero-cost stack baseline (ADR-009) over introducing a paid vendor without discussion.

## Context preservation

When making a significant change, update the closest relevant `.md` (in this repo for backend-operational notes, in `apothem-ai/docs/` for product/architecture/domain decisions) rather than leaving knowledge only in code or a pull request description. Decisions should remain understandable to a future agent with no access to the original conversation.

## Prohibited shortcuts

- cross-tenant queries without tenant/workspace predicates;
- calling AI provider SDKs directly from anywhere outside `src/infrastructure/ai`;
- storing raw third-party credentials in normal application tables instead of the secrets boundary;
- giving agents arbitrary SQL/shell execution as a generic tool;
- executing destructive actions because a model "seems confident";
- treating streaming completion text as the authoritative execution record;
- silently retrying non-idempotent tools;
- removing approval steps to simplify demos;
- using logs as a substitute for an immutable audit trail;
- hand-writing frontend-facing types that duplicate what the OpenAPI spec already generates.
