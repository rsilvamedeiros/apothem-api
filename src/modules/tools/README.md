# tools

**Status:** Implemented (v1) - typed catalog, bindings, policy, workspace rules and a built-in executor, ADR-013 and ADR-015

A tool is an application capability with a typed contract, never model-generated code.

## Pieces

- `domain/tool-catalog.ts` - the catalog: name, description, argument schema (zod, strict) and **risk level** (`read_only`, `reversible_write`, `irreversible`). Built-ins: `get_current_time` (read only), `create_note` (reversible write; notes are soft deleted) and `search_knowledge` (read only, ADR-014).
- `domain/tool-bindings.ts` - the strict contract for an agent version's `toolBindings`: `[{ "tool": "<catalog name>", "approval": "auto" | "required" }]`, each tool at most once, unknown keys rejected. Validated when an agent is published.
- `domain/tool-policy.ts` - `evaluateToolPolicy`: unbound -> deny; irreversible -> always `require_approval`; read only or reversible write -> `allow` only when the binding says `auto`; anything unknown fails closed to `require_approval`. A **workspace rule** (ADR-015) is a ceiling on top of that: `blocked` denies the tool (`TOOL_BLOCKED_BY_POLICY`), `approval_required` forces approval even for a read-only tool bound as `auto`. Order: unbound, blocked, approval, allow; a rule never enables or relaxes anything, and an unknown rule is read as blocked.
- `application/tool-executor.ts` - handlers for the catalog. Writes are idempotent by key (the same key never repeats a side effect), scoped to the workspace and attributed to the requester. Failures are normalized to `{ ok: false }` and never leak details.

## How a run uses them

The model only proposes. For each proposal the runtime checks the binding, validates the arguments against the tool schema, evaluates the policy and then executes, parks the run for approval, or fails it with a stable code (`TOOL_NOT_BOUND`, `TOOL_ARGUMENT_INVALID`, `TOOL_LIMIT_EXCEEDED`, `TOOL_EXECUTION_FAILED`). A run is capped at 3 tool calls. Tool results re-enter the model context as bounded, delimited, user-role data labelled untrusted, never as instructions. See `../runs/README.md` and `../approvals/README.md`.

## Workspace tool policy (ADR-015)

- `application/tool-policy.service.ts` - list (`agent.read`), set and remove (`policy.manage`, owner and admin only). The workspace comes from the authenticated context, the tool must be in the catalog, setting the same rule again is a no-op and is not audited again. Audit events carry the tool and the rules (`tool_policy.set` with `previousRule`, `tool_policy.removed`), never free text.
- `infrastructure/tool-policy.repository.ts` - table `tool_policies` (migration 0006), unique per workspace and tool, upsert on conflict.
- `presentation/http/tool-policies.routes.ts` - `GET`, `PUT /:toolName` and `DELETE /:toolName` under `/v1/organizations/:o/workspaces/:w/tool-policies`.
- The run loop loads the rules when a run starts and fails closed (`RUN_INTERNAL_ERROR`) if it cannot. Blocked tools are not described to the model. A pending approval whose tool is blocked afterwards is invalidated (`APPROVAL_INVALIDATED`), and a direct resume re-checks and ends with `TOOL_BLOCKED_BY_POLICY` without executing.

## Not built yet

External connectors (they will add catalog entries with their own risk level and the secrets boundary), organization-wide rules and per-role thresholds, rate limits, tool-call streaming and provider-native tool result blocks.

Reference docs (`apothem-ai/docs/`): `adr/013-tools-and-approvals-v1.md`, `adr/015-workspace-tool-policy.md`, `04-ai/tool-calling-guardrails.md`, `03-domain/connections-tools.md`.