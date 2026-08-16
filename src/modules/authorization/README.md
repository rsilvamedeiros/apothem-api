# authorization

**Status:** Placeholder — no code yet

Answers "what can this principal do" — RBAC roles plus capability checks (e.g. `agent:run`, `knowledge:write`, `approval:decide`). Authorization always derives scope from authenticated identity and server-side membership, never from a client-supplied tenant/workspace id.

Reference docs (`apothem-ai/docs/`):
- `08-security/authentication-authorization-rbac.md`
- `01-product/permissions-matrix.md`
