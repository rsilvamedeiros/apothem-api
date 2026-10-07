# organizations

**Status:** Implemented - create (bootstrap), read and member management

Owns the Organization aggregate — the principal tenant: subscription, billing, members, global roles, consumption/limits, security policy. Every tenant-owned resource must trace back to an `organization_id`.

Reference docs (`apothem-ai/docs/`):
- `03-domain/organizations-workspaces.md`
- `08-security/tenant-isolation.md`

## Rules enforced (and tested)

- Any authenticated principal may create an organization and becomes its `owner` (active membership); both facts are audited.
- Slugs are globally unique; a duplicate returns 409 and creates no membership or audit event. A concurrent duplicate that slips past the check is stopped by the database unique constraint.
- Reading requires `organization.settings.read` through a resolved tenant context; a principal outside the organization is denied before reaching the service.

## Known limitation

Organization and first-membership creation are two separate writes (no unit of work yet). A failure between them could leave an organization without an owner. Fix together with the transaction boundary work before onboarding real customers.

## Member management

- `GET/POST /v1/organizations/:id/members`, `PATCH /v1/organizations/:id/members/:membershipId` (role) and `POST .../revoke`.
- The actor's organization role bounds the roles they may grant, change or revoke (`authorization/domain/role-assignment.ts`): owners manage all; admins only builder, operator and auditor. A workspace role never widens this.
- The last active owner can never be demoted or revoked; revoked and invited owners do not count.
- Unknown and suspended accounts return the same 404; a foreign membership id is indistinguishable from a missing one.
- Audited as `membership.created`, `membership.reactivated`, `membership.role_changed` and `membership.revoked`.
- Tested at unit, route and real-Postgres level; mutation score about 91% for the service.
