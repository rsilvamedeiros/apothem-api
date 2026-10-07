# approvals

**Status:** Implemented (v1) - durable tool proposals with human decisions, ADR-007 and ADR-013

Owns the approval record: an immutable tool proposal waiting for, or carrying, one human decision.

## Endpoints

- `GET /v1/organizations/:org/workspaces/:ws/approvals?status&limit&cursor` - the inbox (newest first). Needs `approval.decide`.
- `POST .../approvals/:approvalId/decision` with `{ decision: "approve" | "reject", reason? }`. Approving executes the persisted proposal and resumes the run; the response carries the decided approval and the run summary.
- `GET .../runs/:runId` also returns the run's approvals, so the person who started the run can see what is pending.

## Rules enforced (and tested)

- A proposal (tool, validated arguments, run, step) is never changed. The only write after creation is a compare-and-set out of `pending`, so a decision happens exactly once even when several approvers click together. At most one proposal is pending per run (partial unique index).
- `approval.decide` is granted to `owner` and `admin` only; authoring and running are separate duties. The organization role decides, never a workspace role.
- Separation of duties: the requester cannot approve their own proposal while another active owner or admin exists. A sole eligible approver may, and the record and the audit event are marked `selfApproved`.
- Approvals expire (24 hours by default). An expired approval cannot be executed: deciding it marks it `expired` and fails the run with `APPROVAL_EXPIRED`. Listing expires stale pending requests so the inbox never offers a dead one.
- Before executing, the service re-checks that the agent is still active and the run is still waiting. Otherwise the approval is closed (`rejected`, reason `Invalidated: ...`) and the run fails with `APPROVAL_INVALIDATED`. Rejecting fails the run with `APPROVAL_REJECTED` and performs no action.
- The execution key is derived from the approval id, so the action can never repeat. Writes are attributed to the person who started the run, never to the approver or the model.
- Audit: `approval.requested`, `approval.approved`, `approval.rejected`, `approval.invalidated`, `approval.expired`, with ids, tool name and `selfApproved`. Tool arguments and the free-text reason are never copied into audit.

## Not built yet

Per-tenant approval policies (thresholds, required approver roles), delegation, notifications and a configurable expiry.

Reference docs (`apothem-ai/docs/`): `adr/007-human-approval-default.md`, `adr/013-tools-and-approvals-v1.md`, `04-ai/tool-calling-guardrails.md`, `04-ai/agent-runtime.md`.