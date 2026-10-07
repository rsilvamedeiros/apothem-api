# tools

**Status:** Implemented (v1) - typed catalog, bindings, policy and a built-in executor, ADR-013

A tool is an application capability with a typed contract, never model-generated code.

## Pieces

- `domain/tool-catalog.ts` - the catalog: name, description, argument schema (zod, strict) and **risk level** (`read_only`, `reversible_write`, `irreversible`). Built-ins: `get_current_time` (read only) and `create_note` (reversible write; notes are soft deleted).
- `domain/tool-bindings.ts` - the strict contract for an agent version's `toolBindings`: `[{ "tool": "<catalog name>", "approval": "auto" | "required" }]`, each tool at most once, unknown keys rejected. Validated when an agent is published.
- `domain/tool-policy.ts` - `evaluateToolPolicy`: unbound -> deny; irreversible -> always `require_approval`; read only or reversible write -> `allow` only when the binding says `auto`; anything unknown fails closed to `require_approval`.
- `application/tool-executor.ts` - handlers for the catalog. Writes are idempotent by key (the same key never repeats a side effect), scoped to the workspace and attributed to the requester. Failures are normalized to `{ ok: false }` and never leak details.

## How a run uses them

The model only proposes. For each proposal the runtime checks the binding, validates the arguments against the tool schema, evaluates the policy and then executes, parks the run for approval, or fails it with a stable code (`TOOL_NOT_BOUND`, `TOOL_ARGUMENT_INVALID`, `TOOL_LIMIT_EXCEEDED`, `TOOL_EXECUTION_FAILED`). A run is capped at 3 tool calls. Tool results re-enter the model context as bounded, delimited, user-role data labelled untrusted, never as instructions. See `../runs/README.md` and `../approvals/README.md`.

## Not built yet

External connectors (they will add catalog entries with their own risk level and the secrets boundary), per-tenant tool policies, rate limits, tool-call streaming and provider-native tool result blocks.

Reference docs (`apothem-ai/docs/`): `adr/013-tools-and-approvals-v1.md`, `04-ai/tool-calling-guardrails.md`, `03-domain/connections-tools.md`.