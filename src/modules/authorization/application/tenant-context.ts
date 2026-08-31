import type { AuthenticatedPrincipal } from '../../identity/application/principal.js';
import type { OrganizationRole } from '../domain/role.js';

/**
 * Server-resolved authorization scope for one request — never built from a
 * client-supplied organization/workspace id alone. See
 * apothem-ai/docs/08-security/tenant-isolation.md.
 */
export interface TenantContext {
  readonly principal: AuthenticatedPrincipal;
  readonly organizationId: string;
  readonly organizationRole: OrganizationRole;
  readonly workspaceId?: string;
  /** Present only when the membership was narrowed for this workspace; otherwise organizationRole applies. */
  readonly workspaceRole?: OrganizationRole;
}
