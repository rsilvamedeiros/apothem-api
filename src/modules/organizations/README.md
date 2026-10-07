# organizations

**Status:** Implemented — create (bootstrap) and read; membership management API not built yet

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
