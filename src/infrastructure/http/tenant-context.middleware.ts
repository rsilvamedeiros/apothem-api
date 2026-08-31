import type { FastifyRequest } from 'fastify';
import { UnauthenticatedError } from '../../common/errors.js';
import type { AuthenticationPort } from '../../modules/identity/application/authentication.port.js';
import type { AuthenticatedPrincipal } from '../../modules/identity/application/principal.js';
import type { TenantContextResolver } from '../../modules/authorization/application/tenant-context-resolver.js';
import type { TenantContext } from '../../modules/authorization/application/tenant-context.js';

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Bootstrap credential extraction: the `x-principal-id` header IS the
 * credential for the DevHeaderAuthenticator (see identity/infrastructure) and
 * will be replaced by a real session/bearer-token extraction once self-hosted
 * OIDC lands (ADR-009) — routes only depend on AuthenticationPort, so that
 * swap does not touch this call site's callers.
 */
export async function authenticateRequest(
  request: FastifyRequest,
  authenticator: AuthenticationPort,
): Promise<AuthenticatedPrincipal> {
  const credential = headerValue(request.headers['x-principal-id']);
  const principal = await authenticator.authenticate(credential);
  if (!principal) {
    throw new UnauthenticatedError('Missing or invalid credentials');
  }
  return principal;
}

/**
 * organizationId/workspaceId come from the route path (opaque resource ids),
 * not from a header — resolveTenantContext still re-verifies them against
 * server-side membership via TenantContextResolver before trusting them.
 */
export async function resolveTenantContext(
  request: FastifyRequest,
  authenticator: AuthenticationPort,
  tenantContextResolver: TenantContextResolver,
  organizationId: string,
  workspaceId?: string,
): Promise<TenantContext> {
  const principal = await authenticateRequest(request, authenticator);
  return tenantContextResolver.resolve(principal, organizationId, workspaceId);
}
