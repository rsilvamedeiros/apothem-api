import type { Database } from '../database/client.js';
import { PrincipalRepository } from '../../modules/identity/infrastructure/principal.repository.js';
import { ActivePrincipalReader } from '../../modules/identity/infrastructure/active-principal-reader.js';
import { DevHeaderAuthenticator } from '../../modules/identity/infrastructure/dev-header-authenticator.js';
import { MembershipRepository } from '../../modules/organizations/infrastructure/membership.repository.js';
import { WorkspaceRepository } from '../../modules/workspaces/infrastructure/workspace.repository.js';
import { WorkspaceMembershipRepository } from '../../modules/workspaces/infrastructure/workspace-membership.repository.js';
import { TenantContextResolver } from '../../modules/authorization/application/tenant-context-resolver.js';
import { AuthorizationService } from '../../modules/authorization/application/authorization.service.js';
import type { AuthenticationPort } from '../../modules/identity/application/authentication.port.js';

export interface AppServices {
  authenticator: AuthenticationPort;
  tenantContextResolver: TenantContextResolver;
  authorizationService: AuthorizationService;
}

/**
 * Composition root for request-scoped services. `authenticator` is the
 * DevHeaderAuthenticator bootstrap adapter (see identity/infrastructure) —
 * swap this for a real OIDC-backed AuthenticationPort implementation without
 * touching callers, since they only depend on the AuthenticationPort type.
 */
export function buildAppServices(db: Database): AppServices {
  const principals = new PrincipalRepository(db);
  const authenticator = new DevHeaderAuthenticator(new ActivePrincipalReader(principals));
  const tenantContextResolver = new TenantContextResolver(
    new MembershipRepository(db),
    new WorkspaceRepository(db),
    new WorkspaceMembershipRepository(db),
  );
  return { authenticator, tenantContextResolver, authorizationService: new AuthorizationService() };
}
