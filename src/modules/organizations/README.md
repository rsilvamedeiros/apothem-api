# organizations

**Status:** Implemented - create (bootstrap), read and member management

Owns the Organization aggregate — the principal tenant: subscription, billing, members, global roles, consumption/limits, security policy. Every tenant-owned resource must trace back to an `organization_id`.

Reference docs (`apothem-ai/docs/`):
- `03-domain/organizations-workspaces.md`
- `08-security/tenant-isolation.md`

## Rules enforced (and tested)

- Any authenticated principal may create an organization and becomes its `owner` (active membership); both facts are audited.
- Slugs are globally unique; a duplicate returns 409 and creates no membership or audit event, including when a concurrent request wins the race (the unique index decides and the loser gets 409).
- Reading requires `organization.settings.read` through a resolved tenant context; a principal outside the organization is denied before reaching the service.

## Known limitation

Organization and first-membership creation are one atomic write (`OrganizationPort.createWithOwner`, a database transaction): either both exist afterwards or neither does, and the slug is free again after a failure. A slug taken by a concurrent request is reported as 409, not as an internal error. The two audit events are written right after the commit; if that write fails the organization is still usable but its creation is missing from the trail, which is the one remaining gap (audit shares no transaction with the module yet).

## Member management

- `GET/POST /v1/organizations/:id/members`, `PATCH /v1/organizations/:id/members/:membershipId` (role) and `POST .../revoke`.
- The actor's organization role bounds the roles they may grant, change or revoke (`authorization/domain/role-assignment.ts`): owners manage all; admins only builder, operator and auditor. A workspace role never widens this.
- The last active owner can never be demoted or revoked; revoked and invited owners do not count.
- Unknown and suspended accounts return the same 404; a foreign membership id is indistinguishable from a missing one.
- Audited as `membership.created`, `membership.reactivated`, `membership.role_changed` and `membership.revoked`.
- Tested at unit, route and real-Postgres level; mutation score about 91% for the service.
