import type { FastifyRequest } from 'fastify';
import { UnauthenticatedError } from '../../common/errors.js';
import type {
  AuthenticationPort,
  CredentialSource,
} from '../../modules/identity/application/authentication.port.js';
import type { AuthenticatedPrincipal } from '../../modules/identity/application/principal.js';
import type { TenantContextResolver } from '../../modules/authorization/application/tenant-context-resolver.js';
import type { TenantContext } from '../../modules/authorization/application/tenant-context.js';

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const BEARER = /^bearer[ \t]+(\S+)[ \t]*$/i;

/**
 * Pulls the credential from the one place the configured authenticator reads
 * it. The two sources are mutually exclusive on purpose: with a bearer
 * authenticator the `x-principal-id` header is never consulted, so a client
 * cannot impersonate a principal just by sending its id.
 */
export function extractCredential(request: FastifyRequest, source: CredentialSource): string | undefined {
  if (source === 'x-principal-id') {
    return headerValue(request.headers['x-principal-id']);
  }
  const authorization = headerValue(request.headers.authorization);
  return authorization ? BEARER.exec(authorization.trim())?.[1] : undefined;
}

export async function authenticateRequest(
  request: FastifyRequest,
  authenticator: AuthenticationPort,
): Promise<AuthenticatedPrincipal> {
  const credential = extractCredential(request, authenticator.credentialSource);
  const principal = await authenticator.authenticate(credential);
  if (!principal) {
    throw new UnauthenticatedError('Missing or invalid credentials');
  }
  return principal;
}

/**
 * organizationId/workspaceId come from the route path (opaque resource ids),
 * not from a header - resolveTenantContext still re-verifies them against
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
