import { ForbiddenError } from '../../../common/errors.js';
import type { AuthenticatedPrincipal } from '../../identity/application/principal.js';
import type { MembershipReaderPort } from '../../organizations/application/membership-reader.port.js';
import type { WorkspaceReaderPort } from '../../workspaces/application/workspace-reader.port.js';
import type { WorkspaceMembershipReaderPort } from '../../workspaces/application/workspace-membership-reader.port.js';
import type { TenantContext } from './tenant-context.js';

/**
 * Resolves the authorization scope for a request from server-side membership
 * state only. `organizationId`/`workspaceId` arrive from the request (route,
 * header) but are never trusted directly — every id is checked against a
 * membership row scoped to the authenticated principal before it becomes
 * part of the TenantContext. See tenant-isolation.md.
 */
export class TenantContextResolver {
  constructor(
    private readonly memberships: MembershipReaderPort,
    private readonly workspaces: WorkspaceReaderPort,
    private readonly workspaceMemberships: WorkspaceMembershipReaderPort,
  ) {}

  async resolve(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    workspaceId?: string,
  ): Promise<TenantContext> {
    const membership = await this.memberships.findByPrincipalInOrganization(organizationId, principal.id);
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenError(
        `Principal ${principal.id} has no active membership in organization ${organizationId}`,
      );
    }

    if (!workspaceId) {
      return { principal, organizationId, organizationRole: membership.role };
    }

    const workspace = await this.workspaces.findById(organizationId, workspaceId);
    if (!workspace || workspace.status !== 'active') {
      // Same error as "no membership" — do not reveal whether the workspace
      // exists under a different organization to an unauthorized caller.
      throw new ForbiddenError(`Workspace ${workspaceId} is not accessible in organization ${organizationId}`);
    }

    const workspaceMembership = await this.workspaceMemberships.findByMembershipInWorkspace(
      workspaceId,
      membership.id,
    );

    return {
      principal,
      organizationId,
      organizationRole: membership.role,
      workspaceId,
      ...(workspaceMembership?.role ? { workspaceRole: workspaceMembership.role } : {}),
    };
  }
}
