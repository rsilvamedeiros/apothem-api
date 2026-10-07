# workspaces

**Status:** Implemented - create, list and read within an organization

Owns the Workspace aggregate — a flexible operational boundary inside an Organization that can isolate agents, knowledge, connections, workflows, conversations, users and permissions.

Reference docs (`apothem-ai/docs/`):
- `03-domain/organizations-workspaces.md`

## Rules enforced (and tested)

- Creating a workspace requires `workspace.membership.manage` (owner and admin only) and is audited; denied attempts change and audit nothing.
- Slugs are unique per organization and may repeat across organizations.
- Every lookup is scoped by `organizationId` from the resolved tenant context, so another organization's workspace is indistinguishable from a missing one (404).
- Archived workspaces are not resolvable as a tenant scope (see `authorization`).
