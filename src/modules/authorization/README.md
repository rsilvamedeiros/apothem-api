# authorization

**Status:** Implemented (capability RBAC + tenant context resolution)

Answers "what can this principal do". Scope always derives from authenticated identity and server-side membership, never from a client-supplied tenant/workspace id.

## Pieces

- `domain/capability.ts` — the closed list of capabilities and `isOrganizationScoped`.
- `domain/role.ts` — default role bundles (golden-tested against the permission matrix).
- `application/tenant-context-resolver.ts` — turns `principal + organizationId (+ workspaceId)` into a `TenantContext` from membership rows only.
- `application/authorization.service.ts` — the single place capability decisions are made (`can` / `assert`).

## Rules

- Deny by default: unknown capability, unknown or forged role (including inherited keys such as `toString`) all deny.
- A workspace role override applies to workspace capabilities only; `organization.*` capabilities always use the organization role (no privilege escalation through a workspace row).
- Only `active` memberships and `active` workspaces resolve; invited/revoked/archived are denied with the same error as "not found" so existence is not leaked.
- `approval.decide` is granted to no default role; it is policy-driven (ADR-007).

## Tests

- Golden permission matrix, property-based tests (fast-check), tenant-isolation / IDOR and denied-path tests.
- Mutation testing: `npm run test:mutation` (Stryker, per-test coverage, incremental; ~2 min). Score at last run: 97.98%; break threshold 75%.

Reference docs (`apothem-ai/docs/`):
- `08-security/authentication-authorization-rbac.md`
- `08-security/tenant-isolation.md`
- `01-product/permissions-matrix.md`
