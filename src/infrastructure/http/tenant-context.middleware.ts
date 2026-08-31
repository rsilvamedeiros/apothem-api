import type { FastifyRequest } from 'fastify';
import { UnauthenticatedError, ForbiddenError } from '../../common/errors.js';
import type { AuthenticationPort } from '../../modules/identity/application/authentication.port.js';
import type { TenantContextResolver } from '../../modules/authorization/application/tenant-context-resolver.js';
import type { TenantContext } from '../../modules/authorization/application/tenant-context.js';

export interface TenantResolutionDeps {
  authenticator: AuthenticationPort;
  tenantContextResolver: TenantContextResolver;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Transport-layer plumbing only: reads the credential and requested
 * organization/workspace scope off the request. Every one of those values is
 * still re-verified against server-side membership by TenantContextResolver
 * — this function never hands out a TenantContext on the strength of the
 * headers alone.
 */
export async function resolveTenantContext(
  request: FastifyRequest,
  deps: TenantResolutionDeps,
): Promise<TenantContext> {
  const credential = headerValue(request.headers['x-principal-id']);
  const principal = await deps.authenticator.authenticate(credential);
  if (!principal) {
    throw new UnauthenticatedError('Missing or invalid credentials');
  }

  const organizationId = headerValue(request.headers['x-organization-id']);
  if (!organizationId) {
    throw new ForbiddenError('Missing organization scope');
  }

  const workspaceId = headerValue(request.headers['x-workspace-id']);
  return deps.tenantContextResolver.resolve(principal, organizationId, workspaceId);
}
