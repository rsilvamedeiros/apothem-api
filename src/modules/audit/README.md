# audit

**Status:** Implemented - append-only recording and a tenant-scoped read API

Owns immutable audit events for security/business-relevant actions. An audit event is not a substitute for, and is not substituted by, application/diagnostic logs - see `docs/02-architecture/architecture-overview.md`: "Application log vs Audit event".

## Rules enforced (and tested)

- Append-only: the store exposes `record` and `list` only; there is no update or delete.
- `GET /v1/organizations/:organizationId/audit-events` requires the `audit.read` capability (owner, admin, auditor). Builders and operators are denied before any query runs.
- The organization always comes from the resolved tenant context. `workspaceId`, `action` and `actorPrincipalId` filters can only narrow results; a workspace of another organization simply yields nothing.
- Newest first, keyset pagination on `(createdAt, id)` with an opaque cursor. Cursors are untrusted input and are validated before use; `limit` is clamped (default 50, max 200). Equal timestamps cannot skip or repeat events.
- Audit metadata must never contain secrets or personal data beyond opaque ids (see `08-security/audit-retention-lgpd.md`).

## Tests

Cursor codec (round-trip property and rejection cases), query service, HTTP routes (authorization, cross-tenant isolation, pagination, validation) and mutation testing (about 90%).

## Known gaps

- The Drizzle `list` query is covered by type checking and the fake store, not by a database integration test yet. Add one to the CI migration job's Postgres service.
- No retention/export job yet (`audit-retention-lgpd.md`).

Reference docs (`apothem-ai/docs/`):
- `03-domain/executions-audit.md`
- `08-security/audit-retention-lgpd.md`